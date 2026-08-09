import { Password, PasswordPolicy } from '@shared/domain/value-objects/password.vo';
import { Email } from '@shared/domain/value-objects/email.vo';
import { User } from '@modules/authentication/domain/entities/user.entity';
import { UserStatus } from '@modules/authentication/domain/enums/authentication.enums';
import { EmailNotVerifiedException } from '@modules/authentication/domain/exceptions/email-not-verified.exception';
import { AccountSuspendedException } from '@modules/authentication/domain/exceptions/account-suspended.exception';

describe('Password value object', () => {
  it('accepts a valid password', () => {
    const password = Password.create('ValidPass123!');
    expect(password.value).toBe('ValidPass123!');
  });

  it('rejects short passwords', () => {
    expect(() => Password.create('Short1!')).toThrow();
  });

  it('validates via PasswordPolicy', () => {
    expect(() => PasswordPolicy.validatePlaintext('nouppercase1!')).toThrow();
  });
});

describe('Email value object', () => {
  it('normalizes email to lowercase', () => {
    expect(Email.create('User@Example.com').value).toBe('user@example.com');
  });
});

describe('User entity', () => {
  const baseProps = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    phone: null,
    username: null,
    passwordHash: 'argon2id$hash',
    language: 'en',
    preferredCurrency: null,
    notificationOptIn: true,
    marketingOptIn: false,
    status: UserStatus.Active,
    emailVerified: true,
    failedLoginCount: 0,
    lockedUntil: null,
    permissionsVersion: 1,
    sessionVersion: 1,
    passwordChangedAt: null,
    lastLoginAt: null,
    anonymizedAt: null,
    deletionRequestedAt: null,
    scheduledAnonymizationAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  it('allows login for active verified users', () => {
    const user = User.create(baseProps);
    expect(() => user.canLogin()).not.toThrow();
  });

  it('allows login for Active users regardless of emailVerified (ADR-022: retired login gate)', () => {
    const user = User.create({ ...baseProps, emailVerified: false });
    expect(() => user.canLogin()).not.toThrow();
  });

  it('rejects non-Active, non-Locked, non-Suspended users', () => {
    const user = User.create({ ...baseProps, status: UserStatus.Pending });
    expect(() => user.canLogin()).toThrow(EmailNotVerifiedException);
  });

  it('rejects suspended users', () => {
    const user = User.create({ ...baseProps, status: UserStatus.Suspended });
    expect(() => user.canLogin()).toThrow(AccountSuspendedException);
  });

  it('increments session version on bump', () => {
    const user = User.create(baseProps);
    const updated = user.bumpSessionVersion();
    expect(updated.sessionVersion).toBe(2);
  });
});
