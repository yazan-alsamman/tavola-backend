import { DomainException } from '@shared/domain/base/domain-exception.base';

export class ExpiredOtpException extends DomainException {
  public readonly code = 'AUTH_EXPIRED_OTP';

  constructor() {
    super('Verification code has expired. Please request a new one.', 400);
  }
}
