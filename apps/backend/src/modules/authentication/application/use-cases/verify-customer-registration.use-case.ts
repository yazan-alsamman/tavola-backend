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
import { PendingCustomerRegistrationRepository } from '../../domain/repositories/authentication.repositories';
import { OtpService } from '../../domain/services/otp.port';
import { PendingRegistrationPolicy } from '../../domain/services/pending-registration.policy';
import { PendingRegistrationNotFoundException } from '../../domain/exceptions/pending-registration-not-found.exception';
import { InvalidOtpException } from '../../domain/exceptions/invalid-otp.exception';
import { ExpiredOtpException } from '../../domain/exceptions/expired-otp.exception';
import { OtpAttemptsExhaustedException } from '../../domain/exceptions/otp-attempts-exhausted.exception';
import { CustomerPhoneVerifiedEvent } from '../../domain/events/authentication.events';
import { VerifyCustomerRegistrationCommand } from '../dto/verify-customer-registration.command';
import { CustomerOtpResult, CUSTOMER_OTP_VERIFIED_MESSAGE } from '../dto/customer-otp.result';
import {
  OTP_SERVICE,
  PENDING_CUSTOMER_REGISTRATION_REPOSITORY,
  SYSTEM_CONFIGURATION,
} from '../../domain/tokens/authentication.tokens';

/**
 * ADR-022 §"REGISTER — VERIFY": marks the pending registration verified;
 * MUST NOT create the User, set a password, or create a session. Max 5
 * incorrect attempts per issued OTP (Decision #6) - `incrementAttemptCount`
 * runs on every wrong guess, `OtpAttemptsExhaustedException` once the cap
 * is hit (no automatic reissue).
 */
@Injectable()
export class VerifyCustomerRegistrationUseCase {
  constructor(
    @Inject(PENDING_CUSTOMER_REGISTRATION_REPOSITORY)
    private readonly pendingRegistrationRepository: PendingCustomerRegistrationRepository,
    @Inject(OTP_SERVICE) private readonly otpService: OtpService,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(SYSTEM_CONFIGURATION) private readonly systemConfiguration: SystemConfigurationPort,
  ) {}

  async execute(command: VerifyCustomerRegistrationCommand): Promise<CustomerOtpResult> {
    const phone = PhoneNumber.create(command.countryCode, command.phoneNumber);
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
    if (state === 'attempts_exhausted') {
      throw new OtpAttemptsExhaustedException();
    }
    if (state === 'expired') {
      throw new ExpiredOtpException();
    }

    if (!this.otpService.verify(command.code, record.codeHash)) {
      await this.pendingRegistrationRepository.incrementAttemptCount(record.id);
      throw new InvalidOtpException();
    }

    await this.pendingRegistrationRepository.markVerified(record.id, now);

    await this.eventPublisher.publish(
      new CustomerPhoneVerifiedEvent(
        this.idGenerator.generate(),
        { phone: phone.value },
        now,
        command.correlationId,
      ),
    );

    return { message: CUSTOMER_OTP_VERIFIED_MESSAGE };
  }
}
