import { LogoutAllDevicesUseCase } from './logout-all-devices.use-case';
import { AuthenticatedUserActor } from '../dto/authenticated-actor.dto';
import { RegistrationPolicy } from '../../domain/services/registration-policy';
import { Email } from '@shared/domain/value-objects/email.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { DeviceType, SessionRevokeReason } from '../../domain/enums/authentication.enums';
import { UserLoggedOutEvent } from '../../domain/events/authentication.events';
import { InvalidAccessTokenException } from '../exceptions/access-token.exceptions';
import { AccessTokenActorType } from '../../domain/services/access-token-claims';
import { User } from '../../domain/entities/user.entity';
import { DeviceSession } from '../../domain/entities/device-session.entity';
import { TokenFamily } from '../../domain/entities/token-family.entity';
import { SessionPolicy } from '../../domain/services/authentication-policies';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryDeviceSessionRepository,
  InMemoryTokenFamilyRepository,
  InMemoryUserRepository,
  UuidGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('LogoutAllDevicesUseCase', () => {
  const fixedNow = new Date('2026-07-07T18:00:00.000Z');
  const userId = '11111111-1111-4111-8111-111111111111';
  const tokenFamilyId = '22222222-2222-4222-8222-222222222222';
  const sessionId = '33333333-3333-4333-8333-333333333333';
  const otherSessionId = '44444444-4444-4444-8444-444444444444';
  const otherTokenFamilyId = '66666666-6666-4666-8666-666666666666';
  const refreshHash = 'sha256-opaque-token-0';

  const actor: AuthenticatedUserActor = {
    actorType: AccessTokenActorType.User,
    userId,
    sessionId,
    sessionVersion: 1,
    tokenFamilyId,
  };

  function createActiveUser(overrides?: Partial<ReturnType<User['toProps']>>): User {
    const base = RegistrationPolicy.createPendingUser({
      id: userId,
      email: Email.create('logout-all@example.com'),
      passwordHash: PasswordHash.create('argon2id$fake$SecurePass123!'),
      firstName: 'Logout',
      lastName: 'All',
      phone: null,
      language: 'en',
      at: fixedNow,
    }).verifyEmail(fixedNow);

    return User.reconstitute({ ...base.toProps(), ...overrides });
  }

  async function seedActiveSessions(
    deviceSessionRepository: InMemoryDeviceSessionRepository,
    tokenFamilyRepository: InMemoryTokenFamilyRepository,
  ) {
    const refreshExpiry = SessionPolicy.calculateRefreshExpiry(fixedNow, 30);

    for (const [familyId, id] of [
      [tokenFamilyId, sessionId],
      [otherTokenFamilyId, otherSessionId],
    ] as const) {
      await tokenFamilyRepository.save(
        TokenFamily.create({
          id: familyId,
          userId,
          compromisedAt: null,
          revokedAt: null,
          createdAt: fixedNow,
        }),
      );

      await deviceSessionRepository.save(
        DeviceSession.create({
          id,
          userId,
          tokenFamilyId: familyId,
          refreshTokenHash: `${refreshHash}-${id}`,
          previousRefreshTokenHash: null,
          deviceName: id === sessionId ? 'Primary Device' : 'Secondary Device',
          deviceType: DeviceType.Web,
          ipAddress: '127.0.0.1',
          userAgent: 'jest',
          sessionVersion: 1,
          permissionsVersion: 1,
          lastUsedAt: fixedNow,
          revokedAt: null,
          revokedReason: null,
          expiresAt: refreshExpiry,
          createdAt: fixedNow,
        }),
      );
    }
  }

  function createUseCase(overrides?: {
    userRepository?: InMemoryUserRepository;
    deviceSessionRepository?: InMemoryDeviceSessionRepository;
    tokenFamilyRepository?: InMemoryTokenFamilyRepository;
    eventPublisher?: CollectingEventPublisher;
  }) {
    const userRepository = overrides?.userRepository ?? new InMemoryUserRepository();
    const deviceSessionRepository =
      overrides?.deviceSessionRepository ?? new InMemoryDeviceSessionRepository();
    const tokenFamilyRepository =
      overrides?.tokenFamilyRepository ?? new InMemoryTokenFamilyRepository();
    const eventPublisher = overrides?.eventPublisher ?? new CollectingEventPublisher();

    const useCase = new LogoutAllDevicesUseCase(
      userRepository,
      deviceSessionRepository,
      tokenFamilyRepository,
      new ImmediateUnitOfWork(),
      eventPublisher,
      new FixedClock(fixedNow),
      new UuidGenerator(),
    );

    return {
      useCase,
      userRepository,
      deviceSessionRepository,
      tokenFamilyRepository,
      eventPublisher,
    };
  }

  it('logs out all devices and returns the new session version', async () => {
    const { useCase, userRepository, deviceSessionRepository, tokenFamilyRepository } =
      createUseCase();
    await userRepository.save(createActiveUser());
    await seedActiveSessions(deviceSessionRepository, tokenFamilyRepository);

    const result = await useCase.execute({ actor, correlationId: 'corr-all' });

    expect(result.sessionVersion).toBe(2);
  });

  it('increments the user session version inside the unit of work', async () => {
    const { useCase, userRepository, deviceSessionRepository, tokenFamilyRepository } =
      createUseCase();
    await userRepository.save(createActiveUser({ sessionVersion: 3 }));
    await seedActiveSessions(deviceSessionRepository, tokenFamilyRepository);

    const result = await useCase.execute({ actor });

    expect(result.sessionVersion).toBe(4);

    const savedUser = (await userRepository.findById(UserId.create(userId)))!;
    expect(savedUser.sessionVersion).toBe(4);
  });

  it('revokes all active sessions and token families for the user', async () => {
    const { useCase, userRepository, deviceSessionRepository, tokenFamilyRepository } =
      createUseCase();
    await userRepository.save(createActiveUser());
    await seedActiveSessions(deviceSessionRepository, tokenFamilyRepository);

    await useCase.execute({ actor });

    for (const session of deviceSessionRepository.sessions) {
      expect(session.isRevoked()).toBe(true);
      expect(session.toProps().revokedReason).toBe(SessionRevokeReason.SessionVersionBump);
      expect(session.toProps().revokedAt).toEqual(fixedNow);
    }

    for (const family of tokenFamilyRepository.families) {
      expect(family.isRevoked()).toBe(true);
    }
  });

  it('publishes logout event after the unit of work commits', async () => {
    const {
      useCase,
      userRepository,
      deviceSessionRepository,
      tokenFamilyRepository,
      eventPublisher,
    } = createUseCase();
    await userRepository.save(createActiveUser());
    await seedActiveSessions(deviceSessionRepository, tokenFamilyRepository);

    await useCase.execute({ actor, correlationId: 'corr-after-commit' });

    expect(eventPublisher.events).toHaveLength(1);
    expect(eventPublisher.events[0]).toBeInstanceOf(UserLoggedOutEvent);

    const loggedOut = eventPublisher.events[0] as UserLoggedOutEvent;
    expect(loggedOut.payload).toEqual({
      userId,
      scope: 'all',
    });
    expect(loggedOut.correlationId).toBe('corr-after-commit');
  });

  it('bumps session version again on idempotent retry', async () => {
    const {
      useCase,
      userRepository,
      deviceSessionRepository,
      tokenFamilyRepository,
      eventPublisher,
    } = createUseCase();
    await userRepository.save(createActiveUser());
    await seedActiveSessions(deviceSessionRepository, tokenFamilyRepository);

    const first = await useCase.execute({ actor });
    const second = await useCase.execute({ actor });

    expect(first.sessionVersion).toBe(2);
    expect(second.sessionVersion).toBe(3);

    const savedUser = (await userRepository.findById(UserId.create(userId)))!;
    expect(savedUser.sessionVersion).toBe(3);
    expect(eventPublisher.events).toHaveLength(2);
  });

  it('rejects logout when user is missing', async () => {
    const { useCase } = createUseCase();

    await expect(useCase.execute({ actor })).rejects.toBeInstanceOf(InvalidAccessTokenException);
  });
});
