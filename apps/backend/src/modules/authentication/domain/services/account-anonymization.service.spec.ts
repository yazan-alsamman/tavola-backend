import { AccountAnonymizationService } from './account-anonymization.service';
import { RegistrationPolicy } from './registration-policy';
import { UserStatus } from '../enums/authentication.enums';
import { Email } from '@shared/domain/value-objects/email.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';

describe('AccountAnonymizationService', () => {
  const now = new Date('2026-08-07T12:00:00.000Z');
  const userId = '11111111-1111-4111-8111-111111111111';
  const placeholderId = '22222222-2222-4222-8222-222222222222';

  function buildUser() {
    return RegistrationPolicy.createPendingUser({
      id: userId,
      email: Email.create('real-customer@example.com'),
      passwordHash: PasswordHash.create('argon2id$real$hash'),
      firstName: 'Real',
      lastName: 'Customer',
      phone: '+15551234567',
      language: 'en',
      at: now,
    }).verifyEmail(now);
  }

  it('scrubs every direct PII field and marks the account Anonymized', () => {
    const user = buildUser();

    const anonymized = AccountAnonymizationService.anonymize(user, placeholderId, now);

    expect(anonymized.firstName).toBe('Deleted');
    expect(anonymized.lastName).toBe('User');
    expect(anonymized.email?.value).toBe(`deleted-${placeholderId}@anonymized.local`);
    expect(anonymized.phone).toBeNull();
    expect(anonymized.username).toBeNull();
    expect(anonymized.status).toBe(UserStatus.Anonymized);
  });

  it('sets anonymizedAt and clears any pending deletion schedule', () => {
    const requested = buildUser().requestDeletion(
      new Date('2026-09-06T12:00:00.000Z'),
      new Date('2026-08-07T10:00:00.000Z'),
    );

    const anonymized = AccountAnonymizationService.anonymize(requested, placeholderId, now);

    expect(anonymized.toProps().anonymizedAt).toEqual(now);
    expect(anonymized.deletionRequestedAt).toBeNull();
    expect(anonymized.scheduledAnonymizationAt).toBeNull();
  });

  it('invalidates the password hash so it can never verify against the original plaintext', () => {
    const user = buildUser();

    const anonymized = AccountAnonymizationService.anonymize(user, placeholderId, now);

    expect(anonymized.passwordHash.value).not.toBe(user.passwordHash.value);
  });

  it('is a pure transform - the original User instance is left untouched', () => {
    const user = buildUser();

    AccountAnonymizationService.anonymize(user, placeholderId, now);

    expect(user.email?.value).toBe('real-customer@example.com');
    expect(user.status).not.toBe(UserStatus.Anonymized);
  });

  it('never allows the anonymized account to log in again (canLogin rejects Anonymized before any password check)', () => {
    const user = buildUser();
    const anonymized = AccountAnonymizationService.anonymize(user, placeholderId, now);

    expect(() => anonymized.canLogin(now)).toThrow();
  });
});
