import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * Deliberately the same shape/status as an invalid OTP (ADR-022
 * enumeration-resistance requirement) - callers must not be able to
 * distinguish "no pending registration for this phone" from "wrong code"
 * via response behavior.
 */
export class PendingRegistrationNotFoundException extends DomainException {
  public readonly code = 'AUTH_INVALID_OTP';

  constructor() {
    super('Invalid or expired verification request.', 400);
  }
}
