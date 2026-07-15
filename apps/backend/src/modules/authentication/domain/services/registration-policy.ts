import { Email } from '@shared/domain/value-objects/email.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { User } from '../entities/user.entity';
import { UserStatus } from '../enums/authentication.enums';

export interface CreatePendingUserInput {
  id: string;
  email: Email;
  passwordHash: PasswordHash;
  firstName: string;
  lastName: string;
  phone: string | null;
  language: string;
  at: Date;
}

export class RegistrationPolicy {
  static createPendingUser(input: CreatePendingUserInput): User {
    return User.create({
      id: input.id,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      email: input.email.value,
      phone: input.phone,
      passwordHash: input.passwordHash.value,
      language: input.language,
      preferredCurrency: null,
      notificationOptIn: true,
      marketingOptIn: false,
      status: UserStatus.Pending,
      emailVerified: false,
      failedLoginCount: 0,
      lockedUntil: null,
      permissionsVersion: 1,
      sessionVersion: 1,
      passwordChangedAt: null,
      lastLoginAt: null,
      anonymizedAt: null,
      createdAt: input.at,
      updatedAt: input.at,
      deletedAt: null,
    });
  }
}
