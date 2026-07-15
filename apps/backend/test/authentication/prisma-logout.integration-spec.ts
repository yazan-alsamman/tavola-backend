import { PrismaClient, UserStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaUserRepository } from '@modules/authentication/infrastructure/persistence/prisma-user.repository';
import { PrismaDeviceSessionRepository } from '@modules/authentication/infrastructure/persistence/prisma-device-session.repository';
import { PrismaTokenFamilyRepository } from '@modules/authentication/infrastructure/persistence/prisma-token-family.repository';
import { Sha256OpaqueTokenService } from '@modules/authentication/infrastructure/security/sha256-opaque-token.service';
import {
  DeviceType,
  SessionRevokeReason,
} from '@modules/authentication/domain/enums/authentication.enums';
import { SessionPolicy } from '@modules/authentication/domain/services/authentication-policies';
import { DeviceSession } from '@modules/authentication/domain/entities/device-session.entity';
import { TokenFamily } from '@modules/authentication/domain/entities/token-family.entity';
import { UserId, SessionId } from '@shared/domain/value-objects/identifiers.vo';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const prisma = new PrismaClient();
const TEST_PREFIX = 'logout-repo-';
const opaqueTokenService = new Sha256OpaqueTokenService();

describe('Prisma logout repositories (integration)', () => {
  let userRepository: PrismaUserRepository;
  let deviceSessionRepository: PrismaDeviceSessionRepository;
  let tokenFamilyRepository: PrismaTokenFamilyRepository;
  let dbAvailable = false;
  let userId = '';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([
      PrismaUserRepository,
      PrismaDeviceSessionRepository,
      PrismaTokenFamilyRepository,
    ]);

    userRepository = moduleRef.get(PrismaUserRepository);
    deviceSessionRepository = moduleRef.get(PrismaDeviceSessionRepository);
    tokenFamilyRepository = moduleRef.get(PrismaTokenFamilyRepository);

    userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Logout',
        lastName: 'Repo',
        email: `${TEST_PREFIX}@example.com`,
        passwordHash: 'argon2id$test',
        language: 'en',
        status: UserStatus.Active,
        emailVerified: true,
      },
    });
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.deviceSession.deleteMany({ where: { userId } });
      await prisma.tokenFamily.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
      await prisma.$disconnect();
    }
  });

  async function seedSession(sessionId: string, familyId: string, now: Date) {
    await tokenFamilyRepository.save(
      TokenFamily.create({
        id: familyId,
        userId,
        compromisedAt: null,
        revokedAt: null,
        createdAt: now,
      }),
    );

    const refreshToken = opaqueTokenService.generate();
    await deviceSessionRepository.save(
      DeviceSession.create({
        id: sessionId,
        userId,
        tokenFamilyId: familyId,
        refreshTokenHash: opaqueTokenService.hash(refreshToken),
        previousRefreshTokenHash: null,
        deviceName: 'Integration Device',
        deviceType: DeviceType.Web,
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
        sessionVersion: 1,
        permissionsVersion: 1,
        lastUsedAt: now,
        revokedAt: null,
        revokedReason: null,
        expiresAt: SessionPolicy.calculateRefreshExpiry(now, 30),
        createdAt: now,
      }),
    );
  }

  it('revokes owned session by id without cross-user access', async () => {
    if (!dbAvailable) {
      return;
    }

    const now = new Date();
    const sessionId = randomUUID();
    const familyId = randomUUID();
    await seedSession(sessionId, familyId, now);

    const revoked = await deviceSessionRepository.revokeByIdIfOwnedByUser({
      sessionId: SessionId.create(sessionId),
      userId: UserId.create(userId),
      at: now,
      reason: SessionRevokeReason.Logout,
    });
    expect(revoked).toEqual({ status: 'revoked' });

    const crossUser = await deviceSessionRepository.revokeByIdIfOwnedByUser({
      sessionId: SessionId.create(sessionId),
      userId: UserId.create(randomUUID()),
      at: now,
      reason: SessionRevokeReason.Logout,
    });
    expect(crossUser).toEqual({ status: 'not_found_or_not_owned' });
  });

  it('atomically increments sessionVersion for logout-all', async () => {
    if (!dbAvailable) {
      return;
    }

    const now = new Date();
    const before = await prisma.user.findUnique({ where: { id: userId } });
    const version = await userRepository.incrementSessionVersion(UserId.create(userId), now);
    expect(version).toBe((before?.sessionVersion ?? 0) + 1);
  });

  it('revokes all active sessions for logout-all', async () => {
    if (!dbAvailable) {
      return;
    }

    const now = new Date();
    const sessionA = randomUUID();
    const sessionB = randomUUID();
    await seedSession(sessionA, randomUUID(), now);
    await seedSession(sessionB, randomUUID(), now);

    await deviceSessionRepository.revokeAllByUserId(
      UserId.create(userId),
      now,
      SessionRevokeReason.SessionVersionBump,
    );

    const active = await deviceSessionRepository.findActiveByUserId(UserId.create(userId), now);
    expect(active).toHaveLength(0);
  });

  it('allows exactly one concurrent sessionVersion increment per attempt', async () => {
    if (!dbAvailable) {
      return;
    }

    const now = new Date();
    const before = await prisma.user.findUnique({ where: { id: userId } });
    const results = await Promise.all(
      Array.from({ length: 2 }, () =>
        userRepository.incrementSessionVersion(UserId.create(userId), now),
      ),
    );

    expect(results.every((value) => value !== null)).toBe(true);
    const after = await prisma.user.findUnique({ where: { id: userId } });
    expect(after?.sessionVersion).toBe((before?.sessionVersion ?? 0) + 2);
  });
});
