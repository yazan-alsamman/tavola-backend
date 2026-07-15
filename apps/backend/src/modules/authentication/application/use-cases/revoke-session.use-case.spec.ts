import { RevokeSessionUseCase } from './revoke-session.use-case';
import { AuthenticatedUserActor } from '../dto/authenticated-actor.dto';
import { DeviceType, SessionRevokeReason } from '../../domain/enums/authentication.enums';
import { SessionRevokedEvent } from '../../domain/events/authentication.events';
import { SessionAccessDeniedException } from '../exceptions/session-access-denied.exception';
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

describe('RevokeSessionUseCase', () => {
  const fixedNow = new Date('2026-07-07T18:00:00.000Z');
  const userId = '11111111-1111-4111-8111-111111111111';
  const tokenFamilyId = '22222222-2222-4222-8222-222222222222';
  const sessionId = '33333333-3333-4333-8333-333333333333';
  const otherSessionId = '44444444-4444-4444-8444-444444444444';
  const otherUserId = '55555555-5555-4555-8555-555555555555';
  const otherUserTokenFamilyId = '66666666-6666-4666-8666-666666666666';
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
    input: {
      id: string;
      ownerUserId: string;
      familyId: string;
      revokedAt?: Date | null;
    },
  ) {
    await tokenFamilyRepository.save(
      TokenFamily.create({
        id: input.familyId,
        userId: input.ownerUserId,
        compromisedAt: null,
        revokedAt: null,
        createdAt: fixedNow,
      }),
    );

    await deviceSessionRepository.save(
      DeviceSession.create({
        id: input.id,
        userId: input.ownerUserId,
        tokenFamilyId: input.familyId,
        refreshTokenHash: `${refreshHash}-${input.id}`,
        previousRefreshTokenHash: null,
        deviceName: 'Test Device',
        deviceType: DeviceType.Web,
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
        sessionVersion: 1,
        permissionsVersion: 1,
        lastUsedAt: fixedNow,
        revokedAt: input.revokedAt ?? null,
        revokedReason: null,
        expiresAt: SessionPolicy.calculateRefreshExpiry(fixedNow, 30),
        createdAt: fixedNow,
      }),
    );
  }

  function createUseCase(overrides?: {
    deviceSessionRepository?: InMemoryDeviceSessionRepository;
    eventPublisher?: CollectingEventPublisher;
  }) {
    const deviceSessionRepository =
      overrides?.deviceSessionRepository ?? new InMemoryDeviceSessionRepository();
    const eventPublisher = overrides?.eventPublisher ?? new CollectingEventPublisher();

    const useCase = new RevokeSessionUseCase(
      deviceSessionRepository,
      new ImmediateUnitOfWork(),
      eventPublisher,
      new FixedClock(fixedNow),
      new UuidGenerator(),
    );

    return { useCase, deviceSessionRepository, eventPublisher };
  }

  it('revokes a target session owned by the authenticated user', async () => {
    const deviceSessionRepository = new InMemoryDeviceSessionRepository();
    const tokenFamilyRepository = new InMemoryTokenFamilyRepository();
    const { useCase } = createUseCase({ deviceSessionRepository });

    await seedSession(deviceSessionRepository, tokenFamilyRepository, {
      id: sessionId,
      ownerUserId: userId,
      familyId: tokenFamilyId,
    });
    await seedSession(deviceSessionRepository, tokenFamilyRepository, {
      id: otherSessionId,
      ownerUserId: userId,
      familyId: '77777777-7777-4777-8777-777777777777',
    });

    const result = await useCase.execute({
      actor,
      targetSessionId: otherSessionId,
      correlationId: 'corr-revoke',
    });

    expect(result.sessionId).toBe(otherSessionId);

    const stored = (await deviceSessionRepository.findById(SessionId.create(otherSessionId)))!;
    expect(stored.isRevoked()).toBe(true);
    expect(stored.toProps().revokedReason).toBe(SessionRevokeReason.Logout);
    expect(stored.toProps().revokedAt).toEqual(fixedNow);

    const current = (await deviceSessionRepository.findById(SessionId.create(sessionId)))!;
    expect(current.isRevoked()).toBe(false);
  });

  it('rejects revoke when session is missing or owned by another user', async () => {
    const deviceSessionRepository = new InMemoryDeviceSessionRepository();
    const tokenFamilyRepository = new InMemoryTokenFamilyRepository();
    const { useCase } = createUseCase({ deviceSessionRepository });

    await seedSession(deviceSessionRepository, tokenFamilyRepository, {
      id: otherSessionId,
      ownerUserId: otherUserId,
      familyId: otherUserTokenFamilyId,
    });

    await expect(
      useCase.execute({ actor, targetSessionId: otherSessionId }),
    ).rejects.toBeInstanceOf(SessionAccessDeniedException);

    await expect(
      useCase.execute({ actor, targetSessionId: '00000000-0000-4000-8000-000000000099' }),
    ).rejects.toBeInstanceOf(SessionAccessDeniedException);
  });

  it('returns idempotently when the target session is already revoked', async () => {
    const deviceSessionRepository = new InMemoryDeviceSessionRepository();
    const tokenFamilyRepository = new InMemoryTokenFamilyRepository();
    const { useCase, eventPublisher } = createUseCase({ deviceSessionRepository });

    await seedSession(deviceSessionRepository, tokenFamilyRepository, {
      id: otherSessionId,
      ownerUserId: userId,
      familyId: '77777777-7777-4777-8777-777777777777',
      revokedAt: fixedNow,
    });

    const result = await useCase.execute({ actor, targetSessionId: otherSessionId });

    expect(result.sessionId).toBe(otherSessionId);
    expect(eventPublisher.events).toHaveLength(0);
  });

  it('publishes a session revoked event on success', async () => {
    const deviceSessionRepository = new InMemoryDeviceSessionRepository();
    const tokenFamilyRepository = new InMemoryTokenFamilyRepository();
    const { useCase, eventPublisher } = createUseCase({ deviceSessionRepository });

    await seedSession(deviceSessionRepository, tokenFamilyRepository, {
      id: otherSessionId,
      ownerUserId: userId,
      familyId: '77777777-7777-4777-8777-777777777777',
    });

    await useCase.execute({
      actor,
      targetSessionId: otherSessionId,
      correlationId: 'corr-revoked',
    });

    expect(eventPublisher.events).toHaveLength(1);
    expect(eventPublisher.events[0]).toBeInstanceOf(SessionRevokedEvent);

    const revoked = eventPublisher.events[0] as SessionRevokedEvent;
    expect(revoked.payload).toEqual({
      userId,
      sessionId: otherSessionId,
      reason: SessionRevokeReason.Logout,
    });
    expect(revoked.correlationId).toBe('corr-revoked');
  });
});
