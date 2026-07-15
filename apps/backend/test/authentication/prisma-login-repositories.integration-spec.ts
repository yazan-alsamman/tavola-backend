import { PrismaClient, UserStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaUserRepository } from '@modules/authentication/infrastructure/persistence/prisma-user.repository';
import { PrismaDeviceSessionRepository } from '@modules/authentication/infrastructure/persistence/prisma-device-session.repository';
import { PrismaTokenFamilyRepository } from '@modules/authentication/infrastructure/persistence/prisma-token-family.repository';
import { PrismaLoginAttemptRepository } from '@modules/authentication/infrastructure/persistence/prisma-login-attempt.repository';
import { Sha256OpaqueTokenService } from '@modules/authentication/infrastructure/security/sha256-opaque-token.service';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { DeviceType } from '@modules/authentication/domain/enums/authentication.enums';
import { SessionPolicy } from '@modules/authentication/domain/services/authentication-policies';
import { DeviceSession } from '@modules/authentication/domain/entities/device-session.entity';
import { TokenFamily } from '@modules/authentication/domain/entities/token-family.entity';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const prisma = new PrismaClient();
const TEST_PREFIX = 'login-repo-';
const opaqueTokenService = new Sha256OpaqueTokenService();

describe('Prisma login repositories (integration)', () => {
  let deviceSessionRepository: PrismaDeviceSessionRepository;
  let tokenFamilyRepository: PrismaTokenFamilyRepository;
  let loginAttemptRepository: PrismaLoginAttemptRepository;
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
      PrismaLoginAttemptRepository,
    ]);

    deviceSessionRepository = moduleRef.get(PrismaDeviceSessionRepository);
    tokenFamilyRepository = moduleRef.get(PrismaTokenFamilyRepository);
    loginAttemptRepository = moduleRef.get(PrismaLoginAttemptRepository);

    userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Repo',
        lastName: 'Login',
        email: `${TEST_PREFIX}@example.com`,
        passwordHash: 'argon2id$test',
        language: 'en',
        status: UserStatus.Active,
        emailVerified: true,
      },
    });
  });

  afterAll(async () => {
    if (dbAvailable && userId) {
      await prisma.loginAttempt.deleteMany({ where: { identifier: { startsWith: TEST_PREFIX } } });
      await prisma.deviceSession.deleteMany({ where: { userId } });
      await prisma.tokenFamily.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
      await prisma.$disconnect();
    }
  });

  it('persists token family, device session hash, and login attempts', async () => {
    if (!dbAvailable) {
      return;
    }

    const now = new Date();
    const familyId = randomUUID();
    const sessionId = randomUUID();
    const refreshToken = opaqueTokenService.generate();

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
        deviceName: 'Repo Device',
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

    await loginAttemptRepository.save({
      id: randomUUID(),
      identifier: `${TEST_PREFIX}@example.com`,
      ipAddress: '127.0.0.1',
      success: true,
      failureReason: null,
      createdAt: now,
    });

    const activeCount = await deviceSessionRepository.countActiveByUserId(
      UserId.create(userId),
      now,
    );
    expect(activeCount).toBe(1);

    const byHash = await deviceSessionRepository.findByRefreshTokenHash(
      (await import('@shared/domain/value-objects/refresh-token-hash.vo')).RefreshTokenHash.create(
        opaqueTokenService.hash(refreshToken),
      ),
    );
    expect(byHash?.sessionId.value).toBe(sessionId);

    const attempts = await prisma.loginAttempt.count({
      where: { identifier: `${TEST_PREFIX}@example.com`, success: true },
    });
    expect(attempts).toBeGreaterThanOrEqual(1);
  });
});
