import { Injectable, Inject } from '@nestjs/common';
import { PhoneNumber } from '@shared/domain/value-objects/phone-number.vo';
import { ClockPort } from '@shared/application/ports/clock.port';
import {
  SYSTEM_CONFIG_KEYS,
  SystemConfigurationPort,
} from '@shared/application/ports/system-configuration.port';
import {
  CustomerPasswordResetRepository,
  UserRepository,
} from '../../domain/repositories/authentication.repositories';
import { OtpService } from '../../domain/services/otp.port';
import { CustomerPasswordResetPolicy } from '../../domain/services/customer-password-reset.policy';
import { InvalidOtpException } from '../../domain/exceptions/invalid-otp.exception';
import { ExpiredOtpException } from '../../domain/exceptions/expired-otp.exception';
import { OtpAttemptsExhaustedException } from '../../domain/exceptions/otp-attempts-exhausted.exception';
import { VerifyCustomerPasswordResetCommand } from '../dto/customer-password-reset.command';
import { CustomerOtpResult, CUSTOMER_OTP_VERIFIED_MESSAGE } from '../dto/customer-otp.result';
import {
  CLOCK,
  CUSTOMER_PASSWORD_RESET_REPOSITORY,
  OTP_SERVICE,
  SYSTEM_CONFIGURATION,
  USER_REPOSITORY,
} from '../../domain/tokens/authentication.tokens';

/**
 * ADR-022 Decision #16: unlike registration VERIFY (where "no pending
 * registration" is an acceptable, visible outcome — Decision #16 does not
 * require registration-start enumeration resistance), recovery VERIFY must
 * not let a caller distinguish "no account for this phone" / "no active
 * challenge" from "wrong code" — all three collapse to the same
 * `InvalidOtpException`.
 */
@Injectable()
export class VerifyCustomerPasswordResetUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(CUSTOMER_PASSWORD_RESET_REPOSITORY)
    private readonly customerPasswordResetRepository: CustomerPasswordResetRepository,
    @Inject(OTP_SERVICE) private readonly otpService: OtpService,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(SYSTEM_CONFIGURATION) private readonly systemConfiguration: SystemConfigurationPort,
  ) {}

  async execute(command: VerifyCustomerPasswordResetCommand): Promise<CustomerOtpResult> {
    const now = this.clock.now();
    const phone = PhoneNumber.create(command.countryCode, command.phoneNumber);
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
    if (state === 'attempts_exhausted') {
      throw new OtpAttemptsExhaustedException();
    }
    if (state === 'expired') {
      throw new ExpiredOtpException();
    }

    if (!this.otpService.verify(command.code, record.codeHash)) {
      await this.customerPasswordResetRepository.incrementAttemptCount(record.id);
      throw new InvalidOtpException();
    }

    await this.customerPasswordResetRepository.markVerified(record.id, now);

    return { message: CUSTOMER_OTP_VERIFIED_MESSAGE };
  }
}
