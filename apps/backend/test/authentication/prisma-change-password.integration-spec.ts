import { PrismaClient, UserStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaUserRepository } from '@modules/authentication/infrastructure/persistence/prisma-user.repository';
import { PrismaPasswordHistoryRepository } from '@modules/authentication/infrastructure/persistence/prisma-password-history.repository';
import { PrismaPasswordResetRepository } from '@modules/authentication/infrastructure/persistence/prisma-password-reset.repository';
import { PrismaDeviceSessionRepository } from '@modules/authentication/infrastructure/persistence/prisma-device-session.repository';
import { PrismaTokenFamilyRepository } from '@modules/authentication/infrastructure/persistence/prisma-token-family.repository';
import { Sha256OpaqueTokenService } from '@modules/authentication/infrastructure/security/sha256-opaque-token.service';
import { UserId, SessionId, TokenFamilyId } from '@shared/domain/value-objects/identifiers.vo';
import { SessionRevokeReason } from '@modules/authentication/domain/enums/authentication.enums';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const prisma = new PrismaClient();
const TEST_PREFIX = 'change-password-repo-';
const opaqueTokenService = new Sha256OpaqueTokenService();

describe('Prisma change password repositories (integration)', () => {
  let userRepository: PrismaUserRepository;
  let passwordHistoryRepository: PrismaPasswordHistoryRepository;
  let passwordResetRepository: PrismaPasswordResetRepository;
  let deviceSessionRepository: PrismaDeviceSessionRepository;
  let tokenFamilyRepository: PrismaTokenFamilyRepository;
  let dbAvailable = false;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([
      PrismaUserRepository,
      PrismaPasswordHistoryRepository,
      PrismaPasswordResetRepository,
      PrismaDeviceSessionRepository,
      PrismaTokenFamilyRepository,
    ]);

    userRepository = moduleRef.get(PrismaUserRepository);
    passwordHistoryRepository = moduleRef.get(PrismaPasswordHistoryRepository);
    passwordResetRepository = moduleRef.get(PrismaPasswordResetRepository);
    deviceSessionRepository = moduleRef.get(PrismaDeviceSessionRepository);
    tokenFamilyRepository = moduleRef.get(PrismaTokenFamilyRepository);
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
    await prisma.deviceSession.deleteMany({
      where: { user: { email: { startsWith: TEST_PREFIX } } },
    });
    await prisma.tokenFamily.deleteMany({
      where: { user: { email: { startsWith: TEST_PREFIX } } },
    });
    await prisma.user.deleteMany({
      where: { email: { startsWith: TEST_PREFIX } },
    });
    await prisma.$disconnect();
  });

  async function seedUserWithSessions() {
    const userId = randomUUID();
    const currentSessionId = randomUUID();
    const otherSessionId = randomUUID();
    const currentFamilyId = randomUUID();
    const otherFamilyId = randomUUID();
    const currentHash = 'argon2id$current-hash';
    const newHash = 'argon2id$new-hash';
    const now = new Date();

    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Change',
        lastName: 'Repo',
        email: `${TEST_PREFIX}${userId}@example.com`,
        passwordHash: currentHash,
        language: 'en',
        status: UserStatus.Active,
        emailVerified: true,
        sessionVersion: 1,
      },
    });

    for (const [familyId, sessionId] of [
      [currentFamilyId, currentSessionId],
      [otherFamilyId, otherSessionId],
    ] as const) {
      await prisma.tokenFamily.create({
        data: { id: familyId, userId },
      });
      await prisma.deviceSession.create({
        data: {
          id: sessionId,
          userId,
          tokenFamilyId: familyId,
          refreshTokenHash: opaqueTokenService.hash(`refresh-${sessionId}`),
          deviceType: 'web',
          sessionVersion: 1,
          permissionsVersion: 1,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
    }

    await passwordResetRepository.save({
      id: randomUUID(),
      userId,
      tokenHash: opaqueTokenService.hash(`reset-${userId}`),
      expiresAt: new Date(Date.now() + 3_600_000),
      consumedAt: null,
      createdAt: now,
    });

    return { userId, currentSessionId, otherSessionId, currentFamilyId, currentHash, newHash, now };
  }

  it('updates password with CAS and revokes other sessions only', async () => {
    if (!dbAvailable) {
      return;
    }

    const seeded = await seedUserWithSessions();

    await passwordHistoryRepository.save({
      id: randomUUID(),
      userId: seeded.userId,
      passwordHash: seeded.currentHash,
      createdAt: seeded.now,
    });

    const update = await userRepository.updatePasswordIfCurrentHashMatches({
      userId: UserId.create(seeded.userId),
      expectedCurrentHash: seeded.currentHash,
      newHash: seeded.newHash,
      at: seeded.now,
    });
    expect(update.status).toBe('updated');
    if (update.status !== 'updated') {
      throw new Error('Expected password update to succeed.');
    }
    expect(update.sessionVersion).toBe(2);

    await passwordResetRepository.invalidateActiveByUserId(UserId.create(seeded.userId));
    await deviceSessionRepository.revokeAllByUserIdExceptSession({
      userId: UserId.create(seeded.userId),
      exceptSessionId: SessionId.create(seeded.currentSessionId),
      at: seeded.now,
      reason: SessionRevokeReason.PasswordChange,
    });
    await tokenFamilyRepository.revokeAllByUserIdExceptFamily({
      userId: UserId.create(seeded.userId),
      exceptTokenFamilyId: TokenFamilyId.create(seeded.currentFamilyId),
      at: seeded.now,
    });
    await deviceSessionRepository.updateSessionVersionIfActive({
      sessionId: SessionId.create(seeded.currentSessionId),
      userId: UserId.create(seeded.userId),
      sessionVersion: update.sessionVersion,
      at: seeded.now,
    });

    const user = await prisma.user.findUnique({ where: { id: seeded.userId } });
    expect(user?.passwordHash).toBe(seeded.newHash);
    expect(user?.sessionVersion).toBe(2);

    const activeResetTokens = await prisma.passwordResetToken.count({
      where: { userId: seeded.userId, consumedAt: null },
    });
    expect(activeResetTokens).toBe(0);

    const currentSession = await prisma.deviceSession.findUnique({
      where: { id: seeded.currentSessionId },
    });
    const otherSession = await prisma.deviceSession.findUnique({
      where: { id: seeded.otherSessionId },
    });
    expect(currentSession?.revokedAt).toBeNull();
    expect(currentSession?.sessionVersion).toBe(2);
    expect(otherSession?.revokedAt).not.toBeNull();
  });

  it('allows only one concurrent password CAS update to succeed', async () => {
    if (!dbAvailable) {
      return;
    }

    const userId = randomUUID();
    const currentHash = 'argon2id$race-current';
    const newHashA = 'argon2id$race-new-a';
    const newHashB = 'argon2id$race-new-b';
    const now = new Date();

    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Race',
        lastName: 'User',
        email: `${TEST_PREFIX}race-${userId}@example.com`,
        passwordHash: currentHash,
        language: 'en',
        status: UserStatus.Active,
        emailVerified: true,
      },
    });

    const [first, second] = await Promise.all([
      userRepository.updatePasswordIfCurrentHashMatches({
        userId: UserId.create(userId),
        expectedCurrentHash: currentHash,
        newHash: newHashA,
        at: now,
      }),
      userRepository.updatePasswordIfCurrentHashMatches({
        userId: UserId.create(userId),
        expectedCurrentHash: currentHash,
        newHash: newHashB,
        at: now,
      }),
    ]);

    const successes = [first, second].filter((outcome) => outcome.status === 'updated');
    expect(successes).toHaveLength(1);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect([newHashA, newHashB]).toContain(user?.passwordHash);
    expect(user?.sessionVersion).toBe(2);
  });
});
