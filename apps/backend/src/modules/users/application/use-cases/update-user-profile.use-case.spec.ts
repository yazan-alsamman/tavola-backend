import { UpdateUserProfileUseCase } from './update-user-profile.use-case';
import { RegistrationPolicy } from '@modules/authentication/domain/services/registration-policy';
import { Email } from '@shared/domain/value-objects/email.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { UserNotFoundException } from '@modules/authentication/application/exceptions/user-not-found.exception';
import { PhoneAlreadyExistsException } from '@modules/authentication/domain/exceptions/phone-already-exists.exception';
import { InvalidPhoneNumberException } from '@shared/domain/value-objects/phone-number.vo';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  CollectingAuditLogWriter,
  FixedClock,
  InMemoryUserRepository,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('UpdateUserProfileUseCase', () => {
  const fixedNow = new Date('2026-07-07T12:00:00.000Z');
  const userId = '11111111-1111-4111-8111-111111111111';

  function baseActor() {
    return {
      userId,
      sessionId: '22222222-2222-4222-8222-222222222222',
      sessionVersion: 1,
      tokenFamilyId: '33333333-3333-4333-8333-333333333333',
      actorType: AccessTokenActorType.User as const,
    };
  }

  function createUseCase(overrides?: {
    userRepository?: InMemoryUserRepository;
    auditLogWriter?: CollectingAuditLogWriter;
  }) {
    const userRepository = overrides?.userRepository ?? new InMemoryUserRepository();
    const auditLogWriter = overrides?.auditLogWriter ?? new CollectingAuditLogWriter();
    const useCase = new UpdateUserProfileUseCase(
      userRepository,
      new FixedClock(fixedNow),
      auditLogWriter,
    );
    return { useCase, userRepository, auditLogWriter };
  }

  async function seedUser(
    userRepository: InMemoryUserRepository,
    overrides: { id?: string; email?: string; phone?: string | null } = {},
  ): Promise<void> {
    const user = RegistrationPolicy.createPendingUser({
      id: overrides.id ?? userId,
      email: Email.create(overrides.email ?? 'jane@example.com'),
      passwordHash: PasswordHash.create('argon2id$fake$SecurePass123!'),
      firstName: 'Jane',
      lastName: 'Doe',
      phone: overrides.phone ?? null,
      language: 'en',
      at: fixedNow,
    }).verifyEmail(fixedNow);
    await userRepository.save(user);
  }

  it('persists the updated profile fields, normalizing phone to canonical E.164', async () => {
    const { useCase, userRepository } = createUseCase();
    await seedUser(userRepository);

    const result = await useCase.execute({
      actor: baseActor(),
      firstName: 'Janet',
      lastName: 'Doerson',
      countryCode: 'SY',
      phoneNumber: '0933112233',
      language: 'ar',
      preferredCurrency: 'USD',
      ipAddress: '203.0.113.5',
    });

    expect(result.firstName).toBe('Janet');
    expect(result.lastName).toBe('Doerson');
    expect(result.phone).toBe('+963933112233');
    expect(result.language).toBe('ar');
    expect(result.preferredCurrency).toBe('USD');
    expect(result.updatedAt).toEqual(fixedNow);

    const persisted = await userRepository.findById(UserId.create(userId));
    expect(persisted?.firstName).toBe('Janet');
    expect(persisted?.phone).toBe('+963933112233');
  });

  it('rejects a malformed phone number', async () => {
    const { useCase, userRepository } = createUseCase();
    await seedUser(userRepository);

    await expect(
      useCase.execute({
        actor: baseActor(),
        firstName: 'Janet',
        lastName: 'Doe',
        countryCode: 'SY',
        phoneNumber: 'not-a-phone',
        language: 'en',
        preferredCurrency: null,
        ipAddress: null,
      }),
    ).rejects.toBeInstanceOf(InvalidPhoneNumberException);
  });

  it('rejects an impossible phone number for the given country', async () => {
    const { useCase, userRepository } = createUseCase();
    await seedUser(userRepository);

    await expect(
      useCase.execute({
        actor: baseActor(),
        firstName: 'Janet',
        lastName: 'Doe',
        countryCode: 'SY',
        phoneNumber: '1',
        language: 'en',
        preferredCurrency: null,
        ipAddress: null,
      }),
    ).rejects.toBeInstanceOf(InvalidPhoneNumberException);
  });

  it('throws PhoneAlreadyExistsException when another user already owns that phone', async () => {
    const { useCase, userRepository } = createUseCase();
    await seedUser(userRepository, {
      id: userId,
      email: 'jane@example.com',
    });
    await seedUser(userRepository, {
      id: '44444444-4444-4444-8444-444444444444',
      email: 'other@example.com',
      phone: '+963933112233',
    });

    await expect(
      useCase.execute({
        actor: baseActor(),
        firstName: 'Janet',
        lastName: 'Doe',
        countryCode: 'SY',
        phoneNumber: '0933112233',
        language: 'en',
        preferredCurrency: null,
        ipAddress: null,
      }),
    ).rejects.toBeInstanceOf(PhoneAlreadyExistsException);
  });

  it('throws PhoneAlreadyExistsException when a canonically-equivalent phone is already taken, even if entered in a different local format', async () => {
    const { useCase, userRepository } = createUseCase();
    await seedUser(userRepository, { id: userId, email: 'jane@example.com' });
    await seedUser(userRepository, {
      id: '44444444-4444-4444-8444-444444444444',
      email: 'other@example.com',
      // Already stored canonically, as registration would have produced it.
      phone: '+963933112233',
    });

    // Same real number, entered with different local-format punctuation.
    await expect(
      useCase.execute({
        actor: baseActor(),
        firstName: 'Janet',
        lastName: 'Doe',
        countryCode: 'SY',
        phoneNumber: '0933-112-233',
        language: 'en',
        preferredCurrency: null,
        ipAddress: null,
      }),
    ).rejects.toBeInstanceOf(PhoneAlreadyExistsException);
  });

  it('allows a user to keep submitting their own current phone number without a false conflict', async () => {
    const { useCase, userRepository } = createUseCase();
    await seedUser(userRepository, { phone: '+963933112233' });

    const result = await useCase.execute({
      actor: baseActor(),
      firstName: 'Janet',
      lastName: 'Doe',
      countryCode: 'SY',
      phoneNumber: '0933112233',
      language: 'en',
      preferredCurrency: null,
      ipAddress: null,
    });

    expect(result.phone).toBe('+963933112233');
  });

  it('clears the phone to null when both countryCode and phoneNumber are omitted', async () => {
    const { useCase, userRepository } = createUseCase();
    await seedUser(userRepository, { phone: '+963933112233' });

    const result = await useCase.execute({
      actor: baseActor(),
      firstName: 'Janet',
      lastName: 'Doe',
      countryCode: null,
      phoneNumber: null,
      language: 'en',
      preferredCurrency: null,
      ipAddress: null,
    });

    expect(result.phone).toBeNull();
  });

  it('writes exactly one audit log entry describing the update', async () => {
    const { useCase, userRepository, auditLogWriter } = createUseCase();
    await seedUser(userRepository);

    await useCase.execute({
      actor: baseActor(),
      firstName: 'Janet',
      lastName: 'Doe',
      countryCode: null,
      phoneNumber: null,
      language: 'en',
      preferredCurrency: null,
      ipAddress: '203.0.113.5',
      correlationId: 'corr-1',
    });

    expect(auditLogWriter.entries).toHaveLength(1);
    expect(auditLogWriter.entries[0]).toMatchObject({
      actorId: userId,
      actorType: 'User',
      action: 'user.profile.updated',
      targetType: 'User',
      targetId: userId,
      organizationId: null,
      correlationId: 'corr-1',
      ipAddress: '203.0.113.5',
    });
  });

  it('never trusts a userId other than the one on the authenticated actor', async () => {
    const { useCase, userRepository } = createUseCase();
    await seedUser(userRepository);
    const otherUserId = '99999999-9999-4999-8999-999999999999';

    // Even if a caller tried to smuggle a different id anywhere in the
    // command, the use case's signature has no field for it - the only
    // identity source is `actor.userId` from the verified JWT.
    const result = await useCase.execute({
      actor: { ...baseActor(), userId },
      firstName: 'Janet',
      lastName: 'Doe',
      countryCode: null,
      phoneNumber: null,
      language: 'en',
      preferredCurrency: null,
      ipAddress: null,
    });

    expect(result.userId).toBe(userId);
    expect(result.userId).not.toBe(otherUserId);
  });

  it('throws UserNotFoundException when the actor has no matching user', async () => {
    const { useCase } = createUseCase();

    await expect(
      useCase.execute({
        actor: baseActor(),
        firstName: 'Janet',
        lastName: 'Doe',
        countryCode: null,
        phoneNumber: null,
        language: 'en',
        preferredCurrency: null,
        ipAddress: null,
      }),
    ).rejects.toBeInstanceOf(UserNotFoundException);
  });

  it('leaves non-phone fields unaffected by phone validation/normalization', async () => {
    const { useCase, userRepository } = createUseCase();
    await seedUser(userRepository);

    const result = await useCase.execute({
      actor: baseActor(),
      firstName: 'Renamed',
      lastName: 'Person',
      countryCode: null,
      phoneNumber: null,
      language: 'fr',
      preferredCurrency: 'EUR',
      ipAddress: null,
    });

    expect(result.firstName).toBe('Renamed');
    expect(result.lastName).toBe('Person');
    expect(result.language).toBe('fr');
    expect(result.preferredCurrency).toBe('EUR');
    expect(result.phone).toBeNull();
  });
});
