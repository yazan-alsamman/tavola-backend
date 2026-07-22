import { Injectable, Inject } from '@nestjs/common';
import { PhoneNumber } from '@shared/domain/value-objects/phone-number.vo';
import { Username } from '@shared/domain/value-objects/username.vo';
import { ClockPort } from '@shared/application/ports/clock.port';
import {
  SYSTEM_CONFIG_KEYS,
  SystemConfigurationPort,
} from '@shared/application/ports/system-configuration.port';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import {
  PendingCustomerRegistrationRepository,
  UserRepository,
} from '../../domain/repositories/authentication.repositories';
import { OtpService } from '../../domain/services/otp.port';
import { UsernameAlreadyExistsException } from '../../domain/exceptions/username-already-exists.exception';
import { PhoneAlreadyExistsException } from '../../domain/exceptions/phone-already-exists.exception';
import { VerificationMessagingFailedException } from '../../domain/exceptions/verification-messaging-failed.exception';
import { CustomerPhoneVerificationRequestedEvent } from '../../domain/events/authentication.events';
import { StartCustomerRegistrationCommand } from '../dto/start-customer-registration.command';
import { CustomerOtpResult, CUSTOMER_OTP_SENT_MESSAGE } from '../dto/customer-otp.result';
import {
  VerificationMessagingPort,
  VERIFICATION_MESSAGING,
} from '../ports/verification-messaging.port';
import {
  CLOCK,
  EVENT_PUBLISHER,
  ID_GENERATOR,
  OTP_SERVICE,
  PENDING_CUSTOMER_REGISTRATION_REPOSITORY,
  SYSTEM_CONFIGURATION,
  USER_REPOSITORY,
} from '../../domain/tokens/authentication.tokens';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';

/**
 * ADR-022 §"Customer Registration Lifecycle" (START). No `User` row is
 * created here (ADR Note A). Decision #18 (repeated START): a second START
 * for the same canonical phone restarts/reissues the same pending
 * registration via `upsertActive`'s atomic upsert, never creating a second
 * one.
 */
@Injectable()
export class StartCustomerRegistrationUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(PENDING_CUSTOMER_REGISTRATION_REPOSITORY)
    private readonly pendingRegistrationRepository: PendingCustomerRegistrationRepository,
    @Inject(OTP_SERVICE) private readonly otpService: OtpService,
    @Inject(VERIFICATION_MESSAGING)
    private readonly verificationMessaging: VerificationMessagingPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(SYSTEM_CONFIGURATION) private readonly systemConfiguration: SystemConfigurationPort,
  ) {}

  async execute(command: StartCustomerRegistrationCommand): Promise<CustomerOtpResult> {
    const username = Username.create(command.username);
    const phone = PhoneNumber.create(command.countryCode, command.phoneNumber);

    // Duplicate checks against the real User table (an already-registered
    // account) are surfaced explicitly - this is a registration form, not
    // an enumeration-sensitive recovery flow (ADR-022 §35 Error Model lists
    // "duplicate phone"/"duplicate username" as expected, visible errors
    // here, unlike password recovery's own enumeration-resistant START).
    if (await this.userRepository.existsByUsername(username.value)) {
      throw new UsernameAlreadyExistsException();
    }
    if (await this.userRepository.existsByPhone(phone.value)) {
      throw new PhoneAlreadyExistsException();
    }

    const now = this.clock.now();
    const otpExpiryMinutes = await this.systemConfiguration.getNumber(
      SYSTEM_CONFIG_KEYS.otpExpiryMinutes,
      5,
    );
    const code = this.otpService.generate();
    const codeHash = this.otpService.hash(code);
    const codeExpiresAt = new Date(now.getTime() + otpExpiryMinutes * 60_000);

    // Decision #18: throws UsernameAlreadyExistsException if `username`
    // collides with a *different* phone's currently-active pending
    // registration (the table's own unique-on-username constraint) - the
    // check above only guards against an already-completed User, not a
    // concurrently in-progress registration by someone else.
    await this.pendingRegistrationRepository.upsertActive({
      username: username.value,
      phone: phone.value,
      codeHash,
      codeExpiresAt,
      now,
    });

    const sendResult = await this.verificationMessaging.sendVerificationCode(phone, code);
    if (sendResult.status === 'failed') {
      throw new VerificationMessagingFailedException();
    }

    await this.eventPublisher.publish(
      new CustomerPhoneVerificationRequestedEvent(
        this.idGenerator.generate(),
        { phone: phone.value },
        now,
        command.correlationId,
      ),
    );

    return { message: CUSTOMER_OTP_SENT_MESSAGE };
  }
}
