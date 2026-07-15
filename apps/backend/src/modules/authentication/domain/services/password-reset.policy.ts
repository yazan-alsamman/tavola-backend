import { PasswordResetTokenRecord } from '../repositories/authentication.repositories';
import { User } from '../entities/user.entity';
import { UserStatus } from '../enums/authentication.enums';

export type PasswordResetTokenState = 'valid' | 'expired' | 'consumed';

export class PasswordResetPolicy {
  static resolveTokenState(record: PasswordResetTokenRecord, now: Date): PasswordResetTokenState {
    if (record.consumedAt !== null) {
      return 'consumed';
    }
    if (record.expiresAt <= now) {
      return 'expired';
    }
    return 'valid';
  }

  static isUserEligibleForPasswordResetRequest(user: User): boolean {
    if (user.isSoftDeleted() || user.isAnonymized()) {
      return false;
    }
    if (user.status === UserStatus.Suspended || user.status === UserStatus.Deleted) {
      return false;
    }
    if (user.status === UserStatus.Pending) {
      return false;
    }
    return user.status === UserStatus.Active || user.status === UserStatus.Locked;
  }

  static isUserEligibleForPasswordResetConsumption(user: User): boolean {
    return PasswordResetPolicy.isUserEligibleForPasswordResetRequest(user);
  }
}
