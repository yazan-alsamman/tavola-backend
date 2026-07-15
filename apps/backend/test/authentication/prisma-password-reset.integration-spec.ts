import { PrismaClient, UserStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaPasswordResetRepository } from '@modules/authentication/infrastructure/persistence/prisma-password-reset.repository';
import { PrismaPasswordHistoryRepository } from '@modules/authentication/infrastructure/persistence/prisma-password-history.repository';
import { PrismaUserRepository } from '@modules/authentication/infrastructure/persistence/prisma-user.repository';
import { Sha256OpaqueTokenService } from '@modules/authentication/infrastructure/security/sha256-opaque-token.service';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const prisma = new PrismaClient();
const TEST_PREFIX = 'password-reset-repo-';
const opaqueTokenService = new Sha256OpaqueTokenService();

describe('Prisma password reset repositories (integration)', () => {
  let passwordResetRepository: PrismaPasswordResetRepository;
  let passwordHistoryRepository: PrismaPasswordHistoryRepository;
  let userRepository: PrismaUserRepository;
  let dbAvailable = false;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([
      PrismaUserRepository,
      PrismaPasswordResetRepository,
      PrismaPasswordHistoryRepository,
    ]);

    userRepository = moduleRef.get(PrismaUserRepository);
    passwordResetRepository = moduleRef.get(PrismaPasswordResetRepository);
    passwordHistoryRepository = moduleRef.get(PrismaPasswordHistoryRepository);
  });

  afterAll(async () => {
    if (!dbAvailable) {
      return;
    }

    await prisma.passwordResetToken.deleteMany({
      where: { user: { email: { startsWith: TEST_PREFIX } } },
    });
    await prisma.passwordHistory.deleteMany({
      where: { user: { email: { startsWith: TEST_PREFIX } } },
    });
    await prisma.user.deleteMany({
      where: { email: { startsWith: TEST_PREFIX } },
    });
    await prisma.$disconnect();
  });

  async function seedUser() {
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Reset',
        lastName: 'Repo',
        email: `${TEST_PREFIX}${userId}@example.com`,
        passwordHash: 'argon2id$test',
        language: 'en',
        status: UserStatus.Active,
        emailVerified: true,
      },
    });
    return userId;
  }

  it('persists only hashed reset tokens and consumes atomically once', async () => {
    if (!dbAvailable) {
      return;
    }

    const userId = await seedUser();
    const tokenId = randomUUID();
    const opaque = `repo-reset-${randomUUID()}`;
    const tokenHash = opaqueTokenService.hash(opaque);

    await passwordResetRepository.save({
      id: tokenId,
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + 3_600_000),
      consumedAt: null,
      createdAt: new Date(),
    });

    const row = await prisma.passwordResetToken.findUnique({ where: { id: tokenId } });
    expect(row?.tokenHash).toBe(tokenHash);
    expect(row?.tokenHash).not.toBe(opaque);

    const firstConsume = await passwordResetRepository.consumeIfActive(tokenId, new Date());
    const secondConsume = await passwordResetRepository.consumeIfActive(tokenId, new Date());
    expect(firstConsume).toBe(true);
    expect(secondConsume).toBe(false);

    const user = await userRepository.findById(UserId.create(userId));
    expect(user).not.toBeNull();
  });

  it('invalidates active tokens and keeps password history bounded', async () => {
    if (!dbAvailable) {
      return;
    }

    const userId = await seedUser();
    const firstId = randomUUID();
    const secondId = randomUUID();

    await passwordResetRepository.save({
      id: firstId,
      userId,
      tokenHash: opaqueTokenService.hash(`first-${randomUUID()}`),
      expiresAt: new Date(Date.now() + 3_600_000),
      consumedAt: null,
      createdAt: new Date(),
    });

    await passwordResetRepository.invalidateActiveByUserId(UserId.create(userId));
    await passwordResetRepository.save({
      id: secondId,
      userId,
      tokenHash: opaqueTokenService.hash(`second-${randomUUID()}`),
      expiresAt: new Date(Date.now() + 3_600_000),
      consumedAt: null,
      createdAt: new Date(),
    });

    const active = await prisma.passwordResetToken.count({
      where: { userId, consumedAt: null },
    });
    expect(active).toBe(1);

    for (let index = 0; index < 7; index += 1) {
      await passwordHistoryRepository.save({
        id: randomUUID(),
        userId,
        passwordHash: `argon2id$history-${index}`,
        createdAt: new Date(Date.now() + index),
      });
    }
    await passwordHistoryRepository.pruneBeyondLimit(UserId.create(userId), 5);
    const historyCount = await prisma.passwordHistory.count({ where: { userId } });
    expect(historyCount).toBe(5);
  });

  it('handles concurrent forgot-password writes deterministically via user row locking', async () => {
    if (!dbAvailable) {
      return;
    }

    const userId = await seedUser();
    const tokenA = randomUUID();
    const tokenB = randomUUID();
    const now = new Date();

    await Promise.all([
      prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: userId }, data: { updatedAt: now } });
        await tx.passwordResetToken.updateMany({
          where: { userId, consumedAt: null },
          data: { consumedAt: now },
        });
        await tx.passwordResetToken.create({
          data: {
            id: tokenA,
            userId,
            tokenHash: opaqueTokenService.hash(`concurrent-a-${randomUUID()}`),
            expiresAt: new Date(Date.now() + 3_600_000),
          },
        });
      }),
      prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: userId }, data: { updatedAt: now } });
        await tx.passwordResetToken.updateMany({
          where: { userId, consumedAt: null },
          data: { consumedAt: now },
        });
        await tx.passwordResetToken.create({
          data: {
            id: tokenB,
            userId,
            tokenHash: opaqueTokenService.hash(`concurrent-b-${randomUUID()}`),
            expiresAt: new Date(Date.now() + 3_600_000),
          },
        });
      }),
    ]);

    const active = await prisma.passwordResetToken.count({
      where: { userId, consumedAt: null },
    });
    expect(active).toBe(1);
  });

  it('allows only one concurrent reset consumption to succeed', async () => {
    if (!dbAvailable) {
      return;
    }

    const userId = await seedUser();
    const tokenId = randomUUID();
    const consumedAt = new Date();

    await passwordResetRepository.save({
      id: tokenId,
      userId,
      tokenHash: opaqueTokenService.hash(`consume-${randomUUID()}`),
      expiresAt: new Date(Date.now() + 3_600_000),
      consumedAt: null,
      createdAt: consumedAt,
    });

    const [first, second] = await Promise.all([
      passwordResetRepository.consumeIfActive(tokenId, consumedAt),
      passwordResetRepository.consumeIfActive(tokenId, consumedAt),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
  });
});
