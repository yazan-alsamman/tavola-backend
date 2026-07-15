import { PrismaClient, UserStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaDeviceSessionRepository } from '@modules/authentication/infrastructure/persistence/prisma-device-session.repository';
import { PrismaTokenFamilyRepository } from '@modules/authentication/infrastructure/persistence/prisma-token-family.repository';
import { Sha256OpaqueTokenService } from '@modules/authentication/infrastructure/security/sha256-opaque-token.service';
import { DeviceType } from '@modules/authentication/domain/enums/authentication.enums';
import { SessionPolicy } from '@modules/authentication/domain/services/authentication-policies';
import { DeviceSession } from '@modules/authentication/domain/entities/device-session.entity';
import { TokenFamily } from '@modules/authentication/domain/entities/token-family.entity';
import { TokenFamilyId } from '@shared/domain/value-objects/identifiers.vo';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const prisma = new PrismaClient();
const TEST_PREFIX = 'refresh-repo-';
const opaqueTokenService = new Sha256OpaqueTokenService();

describe('Prisma refresh rotation (integration)', () => {
  let deviceSessionRepository: PrismaDeviceSessionRepository;
  let tokenFamilyRepository: PrismaTokenFamilyRepository;
  let dbAvailable = false;
  let userId = '';
  let familyId = '';
  let sessionId = '';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([
      PrismaDeviceSessionRepository,
      PrismaTokenFamilyRepository,
    ]);

    deviceSessionRepository = moduleRef.get(PrismaDeviceSessionRepository);
    tokenFamilyRepository = moduleRef.get(PrismaTokenFamilyRepository);

    userId = randomUUID();
    familyId = randomUUID();
    sessionId = randomUUID();

    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Refresh',
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

  async function seedSession(refreshToken: string, now: Date) {
    await tokenFamilyRepository.save(
      TokenFamily.create({
        id: familyId,
        userId,
        compromisedAt: null,
        revokedAt: null,
        createdAt: now,
      }),
    );

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

  it('atomically rotates refresh token hash and stores previous hash', async () => {
    if (!dbAvailable) {
      return;
    }

    const now = new Date();
    const refreshToken = opaqueTokenService.generate();
    const presentedHash = opaqueTokenService.hash(refreshToken);
    const newToken = opaqueTokenService.generate();
    const newHash = opaqueTokenService.hash(newToken);
    const slidingExpiresAt = SessionPolicy.calculateRefreshExpiry(now, 30);

    await seedSession(refreshToken, now);

    const outcome = await deviceSessionRepository.rotateRefreshTokenIfHashMatches({
      presentedHash,
      newHash,
      now,
      expiresAt: slidingExpiresAt,
      permissionsVersion: 2,
    });

    expect(outcome).toEqual({ status: 'rotated', sessionId });

    const row = await prisma.deviceSession.findUnique({ where: { id: sessionId } });
    expect(row?.refreshTokenHash).toBe(newHash);
    expect(row?.previousRefreshTokenHash).toBe(presentedHash);
    expect(row?.permissionsVersion).toBe(2);
    expect(row?.lastUsedAt?.getTime()).toBe(now.getTime());
    expect(row?.refreshTokenHash).not.toBe(refreshToken);
    expect(row?.refreshTokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns hash_mismatch when presented hash no longer matches', async () => {
    if (!dbAvailable) {
      return;
    }

    const now = new Date();
    const refreshToken = opaqueTokenService.generate();
    const presentedHash = opaqueTokenService.hash(refreshToken);
    familyId = randomUUID();
    sessionId = randomUUID();
    await seedSession(refreshToken, now);

    const firstNewHash = opaqueTokenService.hash(opaqueTokenService.generate());
    await deviceSessionRepository.rotateRefreshTokenIfHashMatches({
      presentedHash,
      newHash: firstNewHash,
      now,
      expiresAt: SessionPolicy.calculateRefreshExpiry(now, 30),
      permissionsVersion: 1,
    });

    const secondAttempt = await deviceSessionRepository.rotateRefreshTokenIfHashMatches({
      presentedHash,
      newHash: opaqueTokenService.hash(opaqueTokenService.generate()),
      now,
      expiresAt: SessionPolicy.calculateRefreshExpiry(now, 30),
      permissionsVersion: 1,
    });

    expect(secondAttempt).toEqual({ status: 'hash_mismatch' });
  });

  it('allows exactly one concurrent rotation for the same refresh token', async () => {
    if (!dbAvailable) {
      return;
    }

    const now = new Date();
    const refreshToken = opaqueTokenService.generate();
    const presentedHash = opaqueTokenService.hash(refreshToken);
    familyId = randomUUID();
    sessionId = randomUUID();
    await seedSession(refreshToken, now);

    const expiresAt = SessionPolicy.calculateRefreshExpiry(now, 30);
    const attempts = await Promise.all(
      Array.from({ length: 2 }, (_, index) =>
        deviceSessionRepository.rotateRefreshTokenIfHashMatches({
          presentedHash,
          newHash: opaqueTokenService.hash(opaqueTokenService.generate() + index),
          now,
          expiresAt,
          permissionsVersion: 1,
        }),
      ),
    );

    const rotated = attempts.filter((attempt) => attempt.status === 'rotated');
    const mismatched = attempts.filter((attempt) => attempt.status === 'hash_mismatch');

    expect(rotated).toHaveLength(1);
    expect(mismatched).toHaveLength(1);

    const row = await prisma.deviceSession.findUnique({ where: { id: sessionId } });
    expect(row?.previousRefreshTokenHash).toBe(presentedHash);
  });

  it('marks token family compromised and revokes sessions on replay persistence path', async () => {
    if (!dbAvailable) {
      return;
    }

    const now = new Date();
    familyId = randomUUID();
    sessionId = randomUUID();
    const currentToken = opaqueTokenService.generate();
    const supersededToken = opaqueTokenService.generate();
    const currentHash = opaqueTokenService.hash(currentToken);
    const supersededHash = opaqueTokenService.hash(supersededToken);

    await tokenFamilyRepository.save(
      TokenFamily.create({
        id: familyId,
        userId,
        compromisedAt: null,
        revokedAt: null,
        createdAt: now,
      }),
    );

    await deviceSessionRepository.save(
      DeviceSession.create({
        id: sessionId,
        userId,
        tokenFamilyId: familyId,
        refreshTokenHash: currentHash,
        previousRefreshTokenHash: supersededHash,
        deviceName: 'Replay Device',
        deviceType: DeviceType.Web,
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
        sessionVersion: 1,
        permissionsVersion: 1,
        lastUsedAt: new Date(now.getTime() - 60_000),
        revokedAt: null,
        revokedReason: null,
        expiresAt: SessionPolicy.calculateRefreshExpiry(now, 30),
        createdAt: now,
      }),
    );

    const compromised = await tokenFamilyRepository.markCompromisedIfActive(
      TokenFamilyId.create(familyId),
      now,
    );
    expect(compromised).toBe(true);

    const familyRow = await prisma.tokenFamily.findUnique({ where: { id: familyId } });
    expect(familyRow?.compromisedAt).not.toBeNull();
  });
});
