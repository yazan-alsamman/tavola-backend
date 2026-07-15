import { User } from './user.entity';
import { UserStatus } from '../enums/authentication.enums';

describe('User entity — updateProfile', () => {
  const baseProps = {
    id: '11111111-1111-4111-8111-111111111111',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    phone: null,
    passwordHash: 'argon2id$fake$SecurePass123!',
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
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
  };

  function createUser(): User {
    return User.reconstitute({ ...baseProps });
  }

  it('returns a new User with the profile fields replaced', () => {
    const user = createUser();
    const at = new Date('2026-02-01T00:00:00.000Z');

    const updated = user.updateProfile(
      {
        firstName: 'Janet',
        lastName: 'Doerson',
        phone: '+963900000000',
        language: 'ar',
        preferredCurrency: 'USD',
      },
      at,
    );

    expect(updated.firstName).toBe('Janet');
    expect(updated.lastName).toBe('Doerson');
    expect(updated.phone).toBe('+963900000000');
    expect(updated.language).toBe('ar');
    expect(updated.preferredCurrency).toBe('USD');
    expect(updated.updatedAt).toEqual(at);
  });

  it('does not mutate the original instance (immutability)', () => {
    const user = createUser();

    user.updateProfile(
      {
        firstName: 'Changed',
        lastName: 'Changed',
        phone: null,
        language: 'fr',
        preferredCurrency: null,
      },
      new Date('2026-02-01T00:00:00.000Z'),
    );

    expect(user.firstName).toBe('Jane');
    expect(user.lastName).toBe('Doe');
    expect(user.language).toBe('en');
  });

  it('never changes credential, status, or version fields', () => {
    const user = createUser();

    const updated = user.updateProfile(
      { firstName: 'Janet', lastName: 'Doe', phone: null, language: 'en', preferredCurrency: null },
      new Date('2026-02-01T00:00:00.000Z'),
    );

    expect(updated.passwordHash.value).toBe(user.passwordHash.value);
    expect(updated.status).toBe(user.status);
    expect(updated.sessionVersion).toBe(user.sessionVersion);
    expect(updated.permissionsVersion).toBe(user.permissionsVersion);
    expect(updated.email.value).toBe(user.email.value);
  });

  it('allows clearing phone and preferredCurrency back to null', () => {
    const user = User.reconstitute({
      ...baseProps,
      phone: '+963900000000',
      preferredCurrency: 'USD',
    });

    const updated = user.updateProfile(
      { firstName: 'Jane', lastName: 'Doe', phone: null, language: 'en', preferredCurrency: null },
      new Date('2026-02-01T00:00:00.000Z'),
    );

    expect(updated.phone).toBeNull();
    expect(updated.preferredCurrency).toBeNull();
  });
});

describe('User entity — updatePreferences', () => {
  const baseProps = {
    id: '11111111-1111-4111-8111-111111111111',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    phone: null,
    passwordHash: 'argon2id$fake$SecurePass123!',
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
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
  };

  function createUser(): User {
    return User.reconstitute({ ...baseProps });
  }

  it('returns a new User with the preference fields replaced', () => {
    const user = createUser();
    const at = new Date('2026-02-01T00:00:00.000Z');

    const updated = user.updatePreferences({ notificationOptIn: false, marketingOptIn: true }, at);

    expect(updated.notificationOptIn).toBe(false);
    expect(updated.marketingOptIn).toBe(true);
    expect(updated.updatedAt).toEqual(at);
  });

  it('does not mutate the original instance (immutability)', () => {
    const user = createUser();

    user.updatePreferences(
      { notificationOptIn: false, marketingOptIn: true },
      new Date('2026-02-01T00:00:00.000Z'),
    );

    expect(user.notificationOptIn).toBe(true);
    expect(user.marketingOptIn).toBe(false);
  });

  it('never changes profile, credential, status, or version fields', () => {
    const user = createUser();

    const updated = user.updatePreferences(
      { notificationOptIn: false, marketingOptIn: true },
      new Date('2026-02-01T00:00:00.000Z'),
    );

    expect(updated.firstName).toBe(user.firstName);
    expect(updated.language).toBe(user.language);
    expect(updated.preferredCurrency).toBe(user.preferredCurrency);
    expect(updated.passwordHash.value).toBe(user.passwordHash.value);
    expect(updated.status).toBe(user.status);
    expect(updated.sessionVersion).toBe(user.sessionVersion);
    expect(updated.permissionsVersion).toBe(user.permissionsVersion);
  });

  it('is a no-op value-wise when the same values are submitted again', () => {
    const user = createUser();

    const updated = user.updatePreferences(
      { notificationOptIn: true, marketingOptIn: false },
      new Date('2026-02-01T00:00:00.000Z'),
    );

    expect(updated.notificationOptIn).toBe(true);
    expect(updated.marketingOptIn).toBe(false);
  });
});
