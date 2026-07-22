import { CustomerPasswordResetTokenRecord } from '../repositories/authentication.repositories';
import { OtpChallengeState } from './pending-registration.policy';

/**
 * Same shape as `PendingRegistrationPolicy` (ADR-022 Decision #16: "reuses,
 * unmodified, every OTP security rule already frozen for registration") -
 * kept as its own class rather than a generic shared one because it
 * operates on a different record type (`CustomerPasswordResetTokenRecord`,
 * userId-keyed) than the registration challenge (phone/username-keyed).
 */
export class CustomerPasswordResetPolicy {
  static resolveChallengeState(
    record: CustomerPasswordResetTokenRecord,
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

  static isVerified(record: CustomerPasswordResetTokenRecord): boolean {
    return record.verifiedAt !== null;
  }
}
