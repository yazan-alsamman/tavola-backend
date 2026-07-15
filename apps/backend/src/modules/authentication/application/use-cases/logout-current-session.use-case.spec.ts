import { LogoutCurrentSessionUseCase } from './logout-current-session.use-case';
import { AuthenticatedUserActor } from '../dto/authenticated-actor.dto';
import { DeviceType, SessionRevokeReason } from '../../domain/enums/authentication.enums';
import { SessionRevokedEvent, UserLoggedOutEvent } from '../../domain/events/authentication.events';
import { InvalidAccessTokenException } from '../exceptions/access-token.exceptions';
import { AccessTokenActorType } from '../../domain/services/access-token-claims';
import { DeviceSession } from '../../domain/entities/device-session.entity';
import { TokenFamily } from '../../domain/entities/token-family.entity';
import { SessionPolicy } from '../../domain/services/authentication-policies';
import { SessionId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryDeviceSessionRepository,
  InMemoryTokenFamilyRepository,
  UuidGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('LogoutCurrentSessionUseCase', () => {
  const fixedNow = new Date('2026-07-07T18:00:00.000Z');
  const userId = '11111111-1111-4111-8111-111111111111';
  const tokenFamilyId = '22222222-2222-4222-8222-222222222222';
  const sessionId = '33333333-3333-4333-8333-333333333333';
  const otherUserId = '55555555-5555-4555-8555-555555555555';
  const refreshHash = 'sha256-opaque-token-0';

  const actor: AuthenticatedUserActor = {
    actorType: AccessTokenActorType.User,
    userId,
    sessionId,
    sessionVersion: 1,
    tokenFamilyId,
  };

  async function seedSession(
    deviceSessionRepository: InMemoryDeviceSessionRepository,
    tokenFamilyRepository: InMemoryTokenFamilyRepository,
    overrides?: {
      sessionUserId?: string;
      sessionTokenFamilyId?: string;
      revokedAt?: Date | null;
    },
  ) {
    const familyId = overrides?.sessionTokenFamilyId ?? tokenFamilyId;
    const ownerId = overrides?.sessionUserId ?? userId;

    await tokenFamilyRepository.save(
      TokenFamily.create({
        id: familyId,
        userId: ownerId,
        compromisedAt: null,
        revokedAt: null,
        createdAt: fixedNow,
      }),
    );

    await deviceSessionRepository.save(
      DeviceSession.create({
        id: sessionId,
        userId: ownerId,
        tokenFamilyId: familyId,
        refreshTokenHash: refreshHash,
        previousRefreshTokenHash: null,
        deviceName: 'Test Device',
        deviceType: DeviceType.Web,
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
        sessionVersion: 1,
        permissionsVersion: 1,
        lastUsedAt: fixedNow,
        revokedAt: overrides?.revokedAt ?? null,
        revokedReason: null,
        expiresAt: SessionPolicy.calculateRefreshExpiry(fixedNow, 30),
        createdAt: fixedNow,
      }),
    );
  }

  function createUseCase(overrides?: {
    deviceSessionRepository?: InMemoryDeviceSessionRepository;
    tokenFamilyRepository?: InMemoryTokenFamilyRepository;
    eventPublisher?: CollectingEventPublisher;
  }) {
    const deviceSessionRepository =
      overrides?.deviceSessionRepository ?? new InMemoryDeviceSessionRepository();
    const tokenFamilyRepository =
      overrides?.tokenFamilyRepository ?? new InMemoryTokenFamilyRepository();
    const eventPublisher = overrides?.eventPublisher ?? new CollectingEventPublisher();

    const useCase = new LogoutCurrentSessionUseCase(
      deviceSessionRepository,
      new ImmediateUnitOfWork(),
      eventPublisher,
      new FixedClock(fixedNow),
      new UuidGenerator(),
    );

    return { useCase, deviceSessionRepository, tokenFamilyRepository, eventPublisher };
  }

  it('revokes the current session on success', async () => {
    const { useCase, deviceSessionRepository, tokenFamilyRepository } = createUseCase();
    await seedSession(deviceSessionRepository, tokenFamilyRepository);

    const result = await useCase.execute({ actor, correlationId: 'corr-1' });

    expect(result.sessionId).toBe(sessionId);

    const stored = (await deviceSessionRepository.findById(SessionId.create(sessionId)))!;
    expect(stored.isRevoked()).toBe(true);
    expect(stored.toProps().revokedReason).toBe(SessionRevokeReason.Logout);
    expect(stored.toProps().revokedAt).toEqual(fixedNow);
  });

  it('rejects logout when session is missing', async () => {
    const { useCase } = createUseCase();

    await expect(useCase.execute({ actor })).rejects.toBeInstanceOf(InvalidAccessTokenException);
  });

  it('rejects logout when session belongs to another user', async () => {
    const { useCase, deviceSessionRepository, tokenFamilyRepository } = createUseCase();
    await seedSession(deviceSessionRepository, tokenFamilyRepository, {
      sessionUserId: otherUserId,
    });

    await expect(useCase.execute({ actor })).rejects.toBeInstanceOf(InvalidAccessTokenException);
  });

  it('rejects logout when token family does not match', async () => {
    const { useCase, deviceSessionRepository, tokenFamilyRepository } = createUseCase();
    await seedSession(deviceSessionRepository, tokenFamilyRepository, {
      sessionTokenFamilyId: '66666666-6666-4666-8666-666666666666',
    });

    await expect(useCase.execute({ actor })).rejects.toBeInstanceOf(InvalidAccessTokenException);
  });

  it('returns idempotently when session is already revoked', async () => {
    const { useCase, deviceSessionRepository, tokenFamilyRepository, eventPublisher } =
      createUseCase();
    await seedSession(deviceSessionRepository, tokenFamilyRepository, {
      revokedAt: fixedNow,
    });

    const result = await useCase.execute({ actor });

    expect(result.sessionId).toBe(sessionId);
    expect(eventPublisher.events).toHaveLength(0);
  });

  it('publishes logout and session revoked events', async () => {
    const { useCase, deviceSessionRepository, tokenFamilyRepository, eventPublisher } =
      createUseCase();
    await seedSession(deviceSessionRepository, tokenFamilyRepository);

    await useCase.execute({ actor, correlationId: 'corr-logout' });

    expect(eventPublisher.events).toHaveLength(2);
    expect(eventPublisher.events[0]).toBeInstanceOf(UserLoggedOutEvent);
    expect(eventPublisher.events[1]).toBeInstanceOf(SessionRevokedEvent);

    const loggedOut = eventPublisher.events[0] as UserLoggedOutEvent;
    expect(loggedOut.payload).toEqual({
      userId,
      sessionId,
      scope: 'current',
    });
    expect(loggedOut.correlationId).toBe('corr-logout');

    const revoked = eventPublisher.events[1] as SessionRevokedEvent;
    expect(revoked.payload).toEqual({
      userId,
      sessionId,
      reason: SessionRevokeReason.Logout,
    });
    expect(revoked.correlationId).toBe('corr-logout');
  });
});
