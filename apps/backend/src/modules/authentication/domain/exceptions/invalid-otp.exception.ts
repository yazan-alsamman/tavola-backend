import { DomainException } from '@shared/domain/base/domain-exception.base';

export class InvalidOtpException extends DomainException {
  public readonly code = 'AUTH_INVALID_OTP';

  constructor() {
    super('Invalid or expired verification code.', 400);
  }
}
