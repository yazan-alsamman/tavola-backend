import { PendingCustomerRegistrationRecord } from '../repositories/authentication.repositories';

export type OtpChallengeState = 'valid' | 'expired' | 'consumed' | 'attempts_exhausted';

/**
 * Mirrors `EmailVerificationPolicy`'s state-resolution shape (ADR-022:
 * "reuses established Clean Architecture conventions... rather than
 * introducing new patterns"), extended with `attempts_exhausted` - a state
 * `EmailVerificationToken` never needed (a 256-bit opaque token isn't
 * brute-forceable; a 6-digit OTP is, so ADR-022 Decision #6 mandates a hard
 * attempt cap this policy must enforce).
 */
export class PendingRegistrationPolicy {
  static resolveChallengeState(
    record: PendingCustomerRegistrationRecord,
    now: Date,
    maxIncorrectAttempts: number,
  ): OtpChallengeState {
    if (record.consumedAt !== null) {
      return 'consumed';
    }
    if (record.incorrectAttemptCount >= maxIncorrectAttempts) {
      return 'attempts_exhausted';
    }
    if (record.codeExpiresAt <= now) {
      return 'expired';
    }
    return 'valid';
  }

  static isVerified(record: PendingCustomerRegistrationRecord): boolean {
    return record.verifiedAt !== null;
  }
}
