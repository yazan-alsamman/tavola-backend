import { Injectable, Inject } from '@nestjs/common';
import { PhoneNumber } from '@shared/domain/value-objects/phone-number.vo';
import { Password } from '@shared/domain/value-objects/password.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { ClockPort } from '@shared/application/ports/clock.port';
import {
  SYSTEM_CONFIG_KEYS,
  SystemConfigurationPort,
} from '@shared/application/ports/system-configuration.port';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import {
  CustomerPasswordResetRepository,
  UserRepository,
} from '../../domain/repositories/authentication.repositories';
import { OtpService } from '../../domain/services/otp.port';
import { PasswordHasher } from '../../domain/services/password-hasher.port';
import { CustomerPasswordResetRequestedEvent } from '../../domain/events/authentication.events';
import { TIMING_SAFE_DUMMY_PASSWORD_HASH } from '../../domain/services/timing-safe-dummy';
import { StartCustomerPasswordResetCommand } from '../dto/customer-password-reset.command';
import { CustomerOtpResult, CUSTOMER_OTP_SENT_MESSAGE } from '../dto/customer-otp.result';
import {
  VerificationMessagingPort,
  VERIFICATION_MESSAGING,
} from '../ports/verification-messaging.port';
import {
  CLOCK,
  CUSTOMER_PASSWORD_RESET_REPOSITORY,
  EVENT_PUBLISHER,
  ID_GENERATOR,
  OTP_SERVICE,
  PASSWORD_HASHER,
  SYSTEM_CONFIGURATION,
  USER_REPOSITORY,
} from '../../domain/tokens/authentication.tokens';

/**
 * ADR-022 Decision #16: enumeration-resistant, mirrors `ForgotPasswordUseCase`
 * exactly - always the same generic response and comparable timing work
 * regardless of whether the phone belongs to an account, so a caller
 * cannot learn account existence from response behavior.
 */
@Injectable()
export class StartCustomerPasswordResetUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(CUSTOMER_PASSWORD_RESET_REPOSITORY)
    private readonly customerPasswordResetRepository: CustomerPasswordResetRepository,
    @Inject(OTP_SERVICE) private readonly otpService: OtpService,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasher,
    @Inject(VERIFICATION_MESSAGING)
    private readonly verificationMessaging: VerificationMessagingPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(SYSTEM_CONFIGURATION) private readonly systemConfiguration: SystemConfigurationPort,
  ) {}

  async execute(command: StartCustomerPasswordResetCommand): Promise<CustomerOtpResult> {
    const now = this.clock.now();
    const phone = PhoneNumber.create(command.countryCode, command.phoneNumber);
    const user = await this.userRepository.findByPhone(phone.value);

    if (user === null) {
      // Comparable-cost dummy work, same rationale as ForgotPasswordUseCase:
      // an unknown phone must not respond measurably faster than a real one.
      await this.passwordHasher.verify(
        Password.create('Dummy-Password-1!'),
        PasswordHash.create(TIMING_SAFE_DUMMY_PASSWORD_HASH),
      );
      return { message: CUSTOMER_OTP_SENT_MESSAGE };
    }

    const otpExpiryMinutes = await this.systemConfiguration.getNumber(
      SYSTEM_CONFIG_KEYS.otpExpiryMinutes,
      5,
    );
    const code = this.otpService.generate();
    const codeHash = this.otpService.hash(code);
    const codeExpiresAt = new Date(now.getTime() + otpExpiryMinutes * 60_000);
    const tokenId = this.idGenerator.generate();

    await this.customerPasswordResetRepository.invalidateActiveByUserId(user.userId);
    await this.customerPasswordResetRepository.save({
      id: tokenId,
      userId: user.userId.value,
      codeHash,
      codeExpiresAt,
      incorrectAttemptCount: 0,
      verifiedAt: null,
      consumedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const sendResult = await this.verificationMessaging.sendVerificationCode(phone, code);
    // A failed provider send during password recovery still returns the
    // same generic response (enumeration resistance takes precedence over
    // surfacing a delivery failure here) - the challenge row exists but its
    // OTP was never actually delivered, so it will simply expire unused.
    void sendResult;

    await this.eventPublisher.publish(
      new CustomerPasswordResetRequestedEvent(
        this.idGenerator.generate(),
        { userId: user.userId.value },
        now,
        command.correlationId,
      ),
    );

    return { message: CUSTOMER_OTP_SENT_MESSAGE };
  }
}
