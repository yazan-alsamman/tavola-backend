import { Injectable, Inject } from '@nestjs/common';
import { PhoneNumber } from '@shared/domain/value-objects/phone-number.vo';
import { ClockPort } from '@shared/application/ports/clock.port';
import {
  SYSTEM_CONFIG_KEYS,
  SystemConfigurationPort,
} from '@shared/application/ports/system-configuration.port';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import { PendingCustomerRegistrationRepository } from '../../domain/repositories/authentication.repositories';
import { OtpService } from '../../domain/services/otp.port';
import { PendingRegistrationNotFoundException } from '../../domain/exceptions/pending-registration-not-found.exception';
import { VerificationMessagingFailedException } from '../../domain/exceptions/verification-messaging-failed.exception';
import { RateLimitExceededException } from '../../domain/exceptions/rate-limit-exceeded.exception';
import { CustomerPhoneVerificationRequestedEvent } from '../../domain/events/authentication.events';
import { ResendCustomerRegistrationCommand } from '../dto/resend-customer-registration.command';
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
} from '../../domain/tokens/authentication.tokens';

/**
 * ADR-022 Decision #6: "resend invalidates the previous OTP, generates a
 * completely new OTP, stores only its hash, resets the incorrect-attempt
 * counter, does NOT bypass send/resend rate limits." Reuses the same
 * `upsertActive` atomic upsert as START (Decision #18) - a resend for a
 * pending registration that does not exist is treated as
 * `PendingRegistrationNotFoundException`, the same shape/status as an
 * invalid OTP, so a caller cannot distinguish "no pending registration"
 * from "wrong code" via response behavior.
 */
@Injectable()
export class ResendCustomerRegistrationUseCase {
  constructor(
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

  async execute(command: ResendCustomerRegistrationCommand): Promise<CustomerOtpResult> {
    const phone = PhoneNumber.create(command.countryCode, command.phoneNumber);
    const existing = await this.pendingRegistrationRepository.findByPhone(phone.value);

    if (existing === null || existing.consumedAt !== null) {
      throw new PendingRegistrationNotFoundException();
    }

    const now = this.clock.now();

    // ADR-022 Decision #6: "resend... does NOT bypass send/resend rate
    // limits" - this is the cooldown component of that guarantee
    // (`RateLimitGuard`'s `customerRegisterSend` policy is the hourly-cap
    // component; the two are complementary, not duplicates). Not
    // enumeration-sensitive (this is a registration form, per this use
    // case's own class doc comment), so a distinct, visible 429 is correct.
    const otpResendCooldownSeconds = await this.systemConfiguration.getNumber(
      SYSTEM_CONFIG_KEYS.otpResendCooldownSeconds,
      60,
    );
    if (now.getTime() - existing.updatedAt.getTime() < otpResendCooldownSeconds * 1000) {
      throw new RateLimitExceededException();
    }

    const otpExpiryMinutes = await this.systemConfiguration.getNumber(
      SYSTEM_CONFIG_KEYS.otpExpiryMinutes,
      5,
    );
    const code = this.otpService.generate();
    const codeHash = this.otpService.hash(code);
    const codeExpiresAt = new Date(now.getTime() + otpExpiryMinutes * 60_000);

    await this.pendingRegistrationRepository.upsertActive({
      username: existing.username,
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
