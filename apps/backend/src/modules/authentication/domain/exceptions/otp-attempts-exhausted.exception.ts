import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * ADR-022: "on the 5th failure the OTP becomes unusable and a new one must
 * be requested - no automatic silent reissue." This exception is thrown
 * instead of a plain InvalidOtpException once the attempt cap is hit, so
 * the client/UI can distinguish "try again" from "you must resend" -
 * without ever revealing the exact remaining-attempts count, which would
 * aid brute-forcing.
 */
export class OtpAttemptsExhaustedException extends DomainException {
  public readonly code = 'AUTH_OTP_ATTEMPTS_EXHAUSTED';

  constructor() {
    super('Too many incorrect attempts. Please request a new verification code.', 400);
  }
}
