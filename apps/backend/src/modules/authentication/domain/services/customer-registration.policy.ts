import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { PhoneNumber } from '@shared/domain/value-objects/phone-number.vo';
import { Username } from '@shared/domain/value-objects/username.vo';
import { User } from '../entities/user.entity';
import { UserStatus } from '../enums/authentication.enums';

export interface CreateActiveCustomerInput {
  id: string;
  username: Username;
  phone: PhoneNumber;
  passwordHash: PasswordHash;
  at: Date;
}

/**
 * ADR-022 Decision #2/#10: a Customer `User` row is created only at
 * `COMPLETE`, already fully usable — phone verification and password
 * already happened before this factory is ever called, so there is no
 * further "Pending"/email-verification gate to satisfy (unlike the legacy
 * `RegistrationPolicy.createPendingUser`, which creates a `Pending` row
 * awaiting a separate email-verification step). `email` is deliberately
 * never set — never a placeholder, never inferred.
 */
export class CustomerRegistrationPolicy {
  static createActiveCustomer(input: CreateActiveCustomerInput): User {
    return User.create({
      id: input.id,
      firstName: null,
      lastName: null,
      email: null,
      phone: input.phone.value,
      username: input.username.value,
      passwordHash: input.passwordHash.value,
      language: 'en',
      preferredCurrency: null,
      notificationOptIn: true,
      marketingOptIn: false,
      status: UserStatus.Active,
      emailVerified: false,
      failedLoginCount: 0,
      lockedUntil: null,
      permissionsVersion: 1,
      sessionVersion: 1,
      passwordChangedAt: null,
      lastLoginAt: null,
      anonymizedAt: null,
      deletionRequestedAt: null,
      scheduledAnonymizationAt: null,
      createdAt: input.at,
      updatedAt: input.at,
      deletedAt: null,
    });
  }
}
