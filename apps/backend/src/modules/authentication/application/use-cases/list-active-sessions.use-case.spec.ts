import { ListActiveSessionsUseCase } from './list-active-sessions.use-case';
import { AuthenticatedUserActor } from '../dto/authenticated-actor.dto';
import { DeviceType } from '../../domain/enums/authentication.enums';
import { AccessTokenActorType } from '../../domain/services/access-token-claims';
import { DeviceSession } from '../../domain/entities/device-session.entity';
import { TokenFamily } from '../../domain/entities/token-family.entity';
import { SessionPolicy } from '../../domain/services/authentication-policies';
import {
  FixedClock,
  InMemoryDeviceSessionRepository,
  InMemoryTokenFamilyRepository,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('ListActiveSessionsUseCase', () => {
  const fixedNow = new Date('2026-07-07T18:00:00.000Z');
  const userId = '11111111-1111-4111-8111-111111111111';
  const tokenFamilyId = '22222222-2222-4222-8222-222222222222';
  const sessionId = '33333333-3333-4333-8333-333333333333';
  const otherSessionId = '44444444-4444-4444-8444-444444444444';
  const otherUserId = '55555555-5555-4555-8555-555555555555';
  const otherUserSessionId = '66666666-6666-4666-8666-666666666666';
  const otherUserTokenFamilyId = '77777777-7777-4777-8777-777777777777';
  const revokedSessionId = '88888888-8888-4888-8888-888888888888';
  const revokedTokenFamilyId = '99999999-9999-4999-8999-999999999999';
  const refreshHash = 'sha256-opaque-token-0';

  const actor: AuthenticatedUserActor = {
    actorType: AccessTokenActorType.User,
    userId,
    sessionId,
    sessionVersion: 1,
    tokenFamilyId,
  };

  function createUseCase(deviceSessionRepository = new InMemoryDeviceSessionRepository()) {
    return {
      useCase: new ListActiveSessionsUseCase(deviceSessionRepository, new FixedClock(fixedNow)),
      deviceSessionRepository,
    };
  }

  async function seedSession(
    deviceSessionRepository: InMemoryDeviceSessionRepository,
    tokenFamilyRepository: InMemoryTokenFamilyRepository,
    input: {
      id: string;
      ownerUserId: string;
      familyId: string;
      deviceName: string;
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
        deviceName: input.deviceName,
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

  async function seedMixedSessions(deviceSessionRepository: InMemoryDeviceSessionRepository) {
    const tokenFamilyRepository = new InMemoryTokenFamilyRepository();

    await seedSession(deviceSessionRepository, tokenFamilyRepository, {
      id: sessionId,
      ownerUserId: userId,
      familyId: tokenFamilyId,
      deviceName: 'Current Device',
    });
    await seedSession(deviceSessionRepository, tokenFamilyRepository, {
      id: otherSessionId,
      ownerUserId: userId,
      familyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      deviceName: 'Other Device',
    });
    await seedSession(deviceSessionRepository, tokenFamilyRepository, {
      id: otherUserSessionId,
      ownerUserId: otherUserId,
      familyId: otherUserTokenFamilyId,
      deviceName: 'Foreign Device',
    });
    await seedSession(deviceSessionRepository, tokenFamilyRepository, {
      id: revokedSessionId,
      ownerUserId: userId,
      familyId: revokedTokenFamilyId,
      deviceName: 'Revoked Device',
      revokedAt: fixedNow,
    });

    return tokenFamilyRepository;
  }

  it('returns only active sessions belonging to the authenticated user', async () => {
    const deviceSessionRepository = new InMemoryDeviceSessionRepository();
    const { useCase } = createUseCase(deviceSessionRepository);
    await seedMixedSessions(deviceSessionRepository);

    const result = await useCase.execute({ actor });

    expect(result.sessions).toHaveLength(2);
    expect(result.sessions.map((session) => session.sessionId).sort()).toEqual(
      [otherSessionId, sessionId].sort(),
    );
    expect(result.sessions.every((session) => session.deviceName !== 'Foreign Device')).toBe(true);
  });

  it('flags the current session in the response', async () => {
    const deviceSessionRepository = new InMemoryDeviceSessionRepository();
    const { useCase } = createUseCase(deviceSessionRepository);
    await seedMixedSessions(deviceSessionRepository);

    const result = await useCase.execute({ actor });

    const current = result.sessions.find((session) => session.sessionId === sessionId);
    const other = result.sessions.find((session) => session.sessionId === otherSessionId);

    expect(current?.isCurrentSession).toBe(true);
    expect(other?.isCurrentSession).toBe(false);
  });

  it('excludes revoked sessions from the list', async () => {
    const deviceSessionRepository = new InMemoryDeviceSessionRepository();
    const { useCase } = createUseCase(deviceSessionRepository);
    await seedMixedSessions(deviceSessionRepository);

    const result = await useCase.execute({ actor });

    expect(result.sessions.some((session) => session.sessionId === revokedSessionId)).toBe(false);
    expect(result.sessions.every((session) => session.deviceName !== 'Revoked Device')).toBe(true);
  });
});
