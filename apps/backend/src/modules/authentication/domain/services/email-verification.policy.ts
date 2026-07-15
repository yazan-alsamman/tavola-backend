import { EmailVerificationTokenRecord } from '../repositories/authentication.repositories';
import { User } from '../entities/user.entity';
import { UserStatus } from '../enums/authentication.enums';

export type EmailVerificationTokenState = 'valid' | 'expired' | 'consumed';

export class EmailVerificationPolicy {
  static resolveTokenState(
    record: EmailVerificationTokenRecord,
    now: Date,
  ): EmailVerificationTokenState {
    if (record.consumedAt !== null) {
      return 'consumed';
    }
    if (record.expiresAt <= now) {
      return 'expired';
    }
    return 'valid';
  }

  static isUserEligibleForVerification(user: User): boolean {
    return user.status === UserStatus.Pending && !user.emailVerified;
  }

  static isAlreadyVerified(user: User): boolean {
    return user.emailVerified || user.status === UserStatus.Active;
  }
}
