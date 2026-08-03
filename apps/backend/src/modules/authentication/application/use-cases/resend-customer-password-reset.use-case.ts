import { Injectable, Inject } from '@nestjs/common';
import { PhoneNumber } from '@shared/domain/value-objects/phone-number.vo';
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
import {
  CustomerPasswordResetRepository,
  UserRepository,
} from '../../domain/repositories/authentication.repositories';
import { OtpService } from '../../domain/services/otp.port';
import { CustomerPasswordResetRequestedEvent } from '../../domain/events/authentication.events';
import { ResendCustomerPasswordResetCommand } from '../dto/customer-password-reset.command';
import { CustomerOtpResult, CUSTOMER_OTP_SENT_MESSAGE } from '../dto/customer-otp.result';
import {
  VerificationMessagingPort,
  VERIFICATION_MESSAGING,
} from '../ports/verification-messaging.port';
import {
  CUSTOMER_PASSWORD_RESET_REPOSITORY,
  OTP_SERVICE,
  SYSTEM_CONFIGURATION,
  USER_REPOSITORY,
} from '../../domain/tokens/authentication.tokens';

/** ADR-022 Decision #16: same enumeration-resistant, generic-response shape as START. */
@Injectable()
export class ResendCustomerPasswordResetUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(CUSTOMER_PASSWORD_RESET_REPOSITORY)
    private readonly customerPasswordResetRepository: CustomerPasswordResetRepository,
    @Inject(OTP_SERVICE) private readonly otpService: OtpService,
    @Inject(VERIFICATION_MESSAGING)
    private readonly verificationMessaging: VerificationMessagingPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(SYSTEM_CONFIGURATION) private readonly systemConfiguration: SystemConfigurationPort,
  ) {}

  async execute(command: ResendCustomerPasswordResetCommand): Promise<CustomerOtpResult> {
    const now = this.clock.now();
    const phone = PhoneNumber.create(command.countryCode, command.phoneNumber);
    const user = await this.userRepository.findByPhone(phone.value);

    if (user === null) {
      return { message: CUSTOMER_OTP_SENT_MESSAGE };
    }

    const active = await this.customerPasswordResetRepository.findActiveByUserId(user.userId, now);
    if (active === null) {
      // No active challenge to resend - same generic response, never
      // reveals that fact distinctly from "sent" (enumeration resistance).
      return { message: CUSTOMER_OTP_SENT_MESSAGE };
    }

    // Cooldown enforced silently (same generic response, never a distinct
    // 429) - unlike registration resend, this flow is enumeration-resistant
    // (Decision #16), so a visibly different outcome for "in cooldown" vs
    // "sent" would itself leak that an active challenge exists.
    const otpResendCooldownSeconds = await this.systemConfiguration.getNumber(
      SYSTEM_CONFIG_KEYS.otpResendCooldownSeconds,
      60,
    );
    if (now.getTime() - active.updatedAt.getTime() < otpResendCooldownSeconds * 1000) {
      return { message: CUSTOMER_OTP_SENT_MESSAGE };
    }

    const otpExpiryMinutes = await this.systemConfiguration.getNumber(
      SYSTEM_CONFIG_KEYS.otpExpiryMinutes,
      5,
    );
    const code = this.otpService.generate();
    const codeHash = this.otpService.hash(code);
    const codeExpiresAt = new Date(now.getTime() + otpExpiryMinutes * 60_000);

    await this.customerPasswordResetRepository.invalidateActiveByUserId(user.userId);
    await this.customerPasswordResetRepository.save({
      id: this.idGenerator.generate(),
      userId: user.userId.value,
      codeHash,
      codeExpiresAt,
      incorrectAttemptCount: 0,
      verifiedAt: null,
      consumedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await this.verificationMessaging.sendVerificationCode(phone, code);

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
