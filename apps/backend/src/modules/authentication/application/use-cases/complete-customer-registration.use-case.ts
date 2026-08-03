import { Injectable, Inject } from '@nestjs/common';
import { PhoneNumber } from '@shared/domain/value-objects/phone-number.vo';
import { Username } from '@shared/domain/value-objects/username.vo';
import { Password } from '@shared/domain/value-objects/password.vo';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import {
  SYSTEM_CONFIG_KEYS,
  SystemConfigurationPort,
} from '@shared/application/ports/system-configuration.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import {
  PendingCustomerRegistrationRepository,
  UserRepository,
} from '../../domain/repositories/authentication.repositories';
import { PasswordHasher } from '../../domain/services/password-hasher.port';
import { PendingRegistrationPolicy } from '../../domain/services/pending-registration.policy';
import { CustomerRegistrationPolicy } from '../../domain/services/customer-registration.policy';
import { PendingRegistrationNotFoundException } from '../../domain/exceptions/pending-registration-not-found.exception';
import { RegistrationNotVerifiedException } from '../../domain/exceptions/registration-not-verified.exception';
import { UsernameAlreadyExistsException } from '../../domain/exceptions/username-already-exists.exception';
import { PhoneAlreadyExistsException } from '../../domain/exceptions/phone-already-exists.exception';
import { CustomerRegistrationCompletedEvent } from '../../domain/events/authentication.events';
import {
  CompleteCustomerRegistrationCommand,
  CompleteCustomerRegistrationResult,
} from '../dto/complete-customer-registration.command';
import {
  PASSWORD_HASHER,
  PENDING_CUSTOMER_REGISTRATION_REPOSITORY,
  SYSTEM_CONFIGURATION,
  USER_REPOSITORY,
} from '../../domain/tokens/authentication.tokens';

/**
 * ADR-022 §"REGISTER — COMPLETE": requires a verified, unconsumed pending
 * registration for the SAME phone; atomically re-checks final uniqueness,
 * hashes the password, creates the real Customer User, and consumes the
 * pending registration - all inside one transaction (`UnitOfWorkPort`),
 * mirroring `ResetPasswordUseCase`'s exact shape (consume-then-mutate
 * inside `unitOfWork.execute`). Two concurrent COMPLETE requests for the
 * same pending registration race on `consumeIfVerifiedAndUnconsumed`'s
 * atomic conditional update - only one can ever win, the other receives
 * `PendingRegistrationNotFoundException` (the row is already consumed by
 * the time it checks).
 */
@Injectable()
export class CompleteCustomerRegistrationUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(PENDING_CUSTOMER_REGISTRATION_REPOSITORY)
    private readonly pendingRegistrationRepository: PendingCustomerRegistrationRepository,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasher,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(SYSTEM_CONFIGURATION) private readonly systemConfiguration: SystemConfigurationPort,
  ) {}

  async execute(
    command: CompleteCustomerRegistrationCommand,
  ): Promise<CompleteCustomerRegistrationResult> {
    const phone = PhoneNumber.create(command.countryCode, command.phoneNumber);
    const password = Password.create(command.password);

    const record = await this.pendingRegistrationRepository.findByPhone(phone.value);
    if (record === null) {
      throw new PendingRegistrationNotFoundException();
    }

    const now = this.clock.now();
    const maxIncorrectAttempts = await this.systemConfiguration.getNumber(
      SYSTEM_CONFIG_KEYS.otpMaxIncorrectAttempts,
      5,
    );
    const state = PendingRegistrationPolicy.resolveChallengeState(
      record,
      now,
      maxIncorrectAttempts,
    );

    if (state === 'consumed') {
      throw new PendingRegistrationNotFoundException();
    }
    if (!PendingRegistrationPolicy.isVerified(record) || state !== 'valid') {
      throw new RegistrationNotVerifiedException();
    }

    // Final race-safe uniqueness re-check (username/phone may have been
    // claimed by someone else between START/VERIFY and this COMPLETE) -
    // still backstopped by the database's own unique constraints inside
    // `userRepository.save()`, which is the actual race-safe boundary; this
    // pre-check only produces a friendlier error for the common
    // non-concurrent case.
    if (await this.userRepository.existsByUsername(record.username)) {
      throw new UsernameAlreadyExistsException();
    }
    if (await this.userRepository.existsByPhone(record.phone)) {
      throw new PhoneAlreadyExistsException();
    }

    const passwordHash = await this.passwordHasher.hash(password);
    const userId = UserId.create(this.idGenerator.generate());

    const user = CustomerRegistrationPolicy.createActiveCustomer({
      id: userId.value,
      username: Username.create(record.username),
      phone: PhoneNumber.fromCanonical(record.phone),
      passwordHash,
      at: now,
    });

    const createdUser = await this.unitOfWork.execute(async () => {
      const consumed = await this.pendingRegistrationRepository.consumeIfVerifiedAndUnconsumed(
        record.id,
        now,
      );
      if (consumed === null) {
        throw new PendingRegistrationNotFoundException();
      }

      await this.userRepository.save(user);
      // Frees the phone/username slot (ADR-022: pending registrations are
      // not retained after COMPLETE, unlike EmailVerificationToken's
      // forever-kept consumed rows - phone/username are reusable,
      // non-random unique keys here).
      await this.pendingRegistrationRepository.deleteById(record.id);

      return user;
    });

    await this.eventPublisher.publish(
      new CustomerRegistrationCompletedEvent(
        this.idGenerator.generate(),
        { userId: createdUser.userId.value, phone: record.phone },
        now,
        command.correlationId,
      ),
    );

    return {
      userId: createdUser.userId.value,
      username: record.username,
      phone: record.phone,
    };
  }
}
