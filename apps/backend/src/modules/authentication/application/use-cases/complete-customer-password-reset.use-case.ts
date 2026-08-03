import { Injectable, Inject } from '@nestjs/common';
import { PhoneNumber } from '@shared/domain/value-objects/phone-number.vo';
import { Password } from '@shared/domain/value-objects/password.vo';
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
  CustomerPasswordResetRepository,
  DeviceSessionRepository,
  PasswordHistoryRepository,
  TokenFamilyRepository,
  UserRepository,
} from '../../domain/repositories/authentication.repositories';
import { PasswordHasher } from '../../domain/services/password-hasher.port';
import { AuthenticationPolicy } from '../../domain/services/authentication-policies';
import { CustomerPasswordResetPolicy } from '../../domain/services/customer-password-reset.policy';
import { InvalidOtpException } from '../../domain/exceptions/invalid-otp.exception';
import { RegistrationNotVerifiedException } from '../../domain/exceptions/registration-not-verified.exception';
import {
  CustomerPasswordResetCompletedEvent,
  SessionRevokedEvent,
} from '../../domain/events/authentication.events';
import { CompleteCustomerPasswordResetCommand } from '../dto/customer-password-reset.command';
import { CustomerOtpResult } from '../dto/customer-otp.result';
import {
  CUSTOMER_PASSWORD_RESET_REPOSITORY,
  DEVICE_SESSION_REPOSITORY,
  PASSWORD_HASHER,
  PASSWORD_HISTORY_REPOSITORY,
  SYSTEM_CONFIGURATION,
  TOKEN_FAMILY_REPOSITORY,
  USER_REPOSITORY,
} from '../../domain/tokens/authentication.tokens';

/**
 * ADR-022 §"REGISTER — COMPLETE"-equivalent for recovery: requires a
 * verified, unconsumed challenge for the SAME phone; password changes only
 * here (VERIFY never changed it). Reuses `AuthenticationPolicy.assertPasswordNotReused`
 * and revokes all sessions on completion - the exact same security posture
 * `ResetPasswordUseCase` already applies for Owner/staff, not weakened for
 * Customers.
 */
@Injectable()
export class CompleteCustomerPasswordResetUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(CUSTOMER_PASSWORD_RESET_REPOSITORY)
    private readonly customerPasswordResetRepository: CustomerPasswordResetRepository,
    @Inject(PASSWORD_HISTORY_REPOSITORY)
    private readonly passwordHistoryRepository: PasswordHistoryRepository,
    @Inject(DEVICE_SESSION_REPOSITORY)
    private readonly deviceSessionRepository: DeviceSessionRepository,
    @Inject(TOKEN_FAMILY_REPOSITORY)
    private readonly tokenFamilyRepository: TokenFamilyRepository,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasher,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(SYSTEM_CONFIGURATION) private readonly systemConfiguration: SystemConfigurationPort,
  ) {}

  async execute(command: CompleteCustomerPasswordResetCommand): Promise<CustomerOtpResult> {
    const now = this.clock.now();
    const phone = PhoneNumber.create(command.countryCode, command.phoneNumber);
    const newPassword = Password.create(command.newPassword);
    const user = await this.userRepository.findByPhone(phone.value);

    if (user === null) {
      throw new InvalidOtpException();
    }

    const record = await this.customerPasswordResetRepository.findActiveByUserId(user.userId, now);
    if (record === null) {
      throw new InvalidOtpException();
    }

    const maxIncorrectAttempts = await this.systemConfiguration.getNumber(
      SYSTEM_CONFIG_KEYS.otpMaxIncorrectAttempts,
      5,
    );
    const state = CustomerPasswordResetPolicy.resolveChallengeState(
      record,
      now,
      maxIncorrectAttempts,
    );

    if (state === 'consumed') {
      throw new InvalidOtpException();
    }
    if (!CustomerPasswordResetPolicy.isVerified(record) || state !== 'valid') {
      throw new RegistrationNotVerifiedException();
    }

    const passwordHistoryCount = await this.systemConfiguration.getNumber(
      SYSTEM_CONFIG_KEYS.passwordHistoryCount,
      5,
    );
    const history = await this.passwordHistoryRepository.findRecentByUserId(
      user.userId,
      passwordHistoryCount,
    );
    await AuthenticationPolicy.assertPasswordNotReused(
      newPassword,
      user.passwordHash,
      history,
      this.passwordHasher,
    );

    const newPasswordHash = await this.passwordHasher.hash(newPassword);
    const activeSessions = await this.deviceSessionRepository.findActiveByUserId(user.userId, now);

    const updatedUser = await this.unitOfWork.execute(async () => {
      const consumed = await this.customerPasswordResetRepository.consumeIfVerifiedAndUnconsumed(
        record.id,
        now,
      );
      if (consumed === null) {
        throw new InvalidOtpException();
      }

      await this.passwordHistoryRepository.save({
        id: this.idGenerator.generate(),
        userId: user.userId.value,
        passwordHash: user.passwordHash.value,
        createdAt: now,
      });

      const resetUser = user.completePasswordReset(newPasswordHash, now);
      await this.userRepository.save(resetUser);
      await this.passwordHistoryRepository.pruneBeyondLimit(user.userId, passwordHistoryCount);
      await this.deviceSessionRepository.revokeAllByUserId(user.userId, now, 'password_change');
      await this.tokenFamilyRepository.revokeAllByUserId(user.userId, now);

      return resetUser;
    });

    await this.eventPublisher.publish(
      new CustomerPasswordResetCompletedEvent(
        this.idGenerator.generate(),
        { userId: updatedUser.userId.value },
        now,
        command.correlationId,
      ),
    );

    for (const session of activeSessions) {
      await this.eventPublisher.publish(
        new SessionRevokedEvent(
          this.idGenerator.generate(),
          {
            userId: updatedUser.userId.value,
            sessionId: session.sessionId.value,
            reason: 'password_change',
          },
          now,
          command.correlationId,
        ),
      );
    }

    return { message: 'Password reset successfully.' };
  }
}
