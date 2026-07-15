import { UpdateUserPreferencesUseCase } from './update-user-preferences.use-case';
import { RegistrationPolicy } from '@modules/authentication/domain/services/registration-policy';
import { Email } from '@shared/domain/value-objects/email.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { UserNotFoundException } from '@modules/authentication/application/exceptions/user-not-found.exception';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  CollectingAuditLogWriter,
  FixedClock,
  InMemoryUserRepository,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('UpdateUserPreferencesUseCase', () => {
  const fixedNow = new Date('2026-07-15T12:00:00.000Z');
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
    const useCase = new UpdateUserPreferencesUseCase(
      userRepository,
      new FixedClock(fixedNow),
      auditLogWriter,
    );
    return { useCase, userRepository, auditLogWriter };
  }

  async function seedUser(userRepository: InMemoryUserRepository): Promise<void> {
    const user = RegistrationPolicy.createPendingUser({
      id: userId,
      email: Email.create('jane@example.com'),
      passwordHash: PasswordHash.create('argon2id$fake$SecurePass123!'),
      firstName: 'Jane',
      lastName: 'Doe',
      phone: null,
      language: 'en',
      at: fixedNow,
    }).verifyEmail(fixedNow);
    await userRepository.save(user);
  }

  it('persists the updated preference fields and returns them', async () => {
    const { useCase, userRepository } = createUseCase();
    await seedUser(userRepository);

    const result = await useCase.execute({
      actor: baseActor(),
      notificationOptIn: false,
      marketingOptIn: true,
      ipAddress: '203.0.113.5',
    });

    expect(result.notificationOptIn).toBe(false);
    expect(result.marketingOptIn).toBe(true);
    expect(result.updatedAt).toEqual(fixedNow);

    const persisted = await userRepository.findById(UserId.create(userId));
    expect(persisted?.notificationOptIn).toBe(false);
    expect(persisted?.marketingOptIn).toBe(true);
  });

  it('never touches profile fields owned by UpdateUserProfileUseCase', async () => {
    const { useCase, userRepository } = createUseCase();
    await seedUser(userRepository);

    await useCase.execute({
      actor: baseActor(),
      notificationOptIn: false,
      marketingOptIn: true,
      ipAddress: null,
    });

    const persisted = await userRepository.findById(UserId.create(userId));
    expect(persisted?.firstName).toBe('Jane');
    expect(persisted?.language).toBe('en');
    expect(persisted?.preferredCurrency).toBeNull();
  });

  it('writes exactly one audit log entry describing the update', async () => {
    const { useCase, userRepository, auditLogWriter } = createUseCase();
    await seedUser(userRepository);

    await useCase.execute({
      actor: baseActor(),
      notificationOptIn: false,
      marketingOptIn: true,
      ipAddress: '203.0.113.5',
      correlationId: 'corr-1',
    });

    expect(auditLogWriter.entries).toHaveLength(1);
    expect(auditLogWriter.entries[0]).toMatchObject({
      actorId: userId,
      actorType: 'User',
      action: 'user.preferences.updated',
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

    // The use case's signature has no field for a client-supplied id - the
    // only identity source is `actor.userId` from the verified JWT.
    const result = await useCase.execute({
      actor: { ...baseActor(), userId },
      notificationOptIn: false,
      marketingOptIn: true,
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
        notificationOptIn: false,
        marketingOptIn: true,
        ipAddress: null,
      }),
    ).rejects.toBeInstanceOf(UserNotFoundException);
  });
});
