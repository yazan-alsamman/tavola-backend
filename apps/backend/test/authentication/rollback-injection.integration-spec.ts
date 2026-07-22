import { PrismaClient, UserStatus as PrismaUserStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { RefreshSessionUseCase } from '@modules/authentication/application/use-cases/refresh-session.use-case';
import { LogoutAllDevicesUseCase } from '@modules/authentication/application/use-cases/logout-all-devices.use-case';
import { ResetPasswordUseCase } from '@modules/authentication/application/use-cases/reset-password.use-case';
import { ChangePasswordUseCase } from '@modules/authentication/application/use-cases/change-password.use-case';
import { PrismaUserRepository } from '@modules/authentication/infrastructure/persistence/prisma-user.repository';
import { PrismaDeviceSessionRepository } from '@modules/authentication/infrastructure/persistence/prisma-device-session.repository';
import { PrismaTokenFamilyRepository } from '@modules/authentication/infrastructure/persistence/prisma-token-family.repository';
import { PrismaPasswordHistoryRepository } from '@modules/authentication/infrastructure/persistence/prisma-password-history.repository';
import { PrismaPasswordResetRepository } from '@modules/authentication/infrastructure/persistence/prisma-password-reset.repository';
import { PrismaSystemConfiguration } from '@modules/authentication/infrastructure/persistence/prisma-system-configuration';
import { PrismaUnitOfWork } from '@modules/authentication/infrastructure/persistence/prisma-unit-of-work';
import { Sha256OpaqueTokenService } from '@modules/authentication/infrastructure/security/sha256-opaque-token.service';
import {
  DeviceSessionRepository,
  TokenFamilyRepository,
} from '@modules/authentication/domain/repositories/authentication.repositories';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { Password } from '@shared/domain/value-objects/password.vo';
import {
  CollectingEventPublisher,
  FixedClock,
  UuidGenerator,
  FixedAuthRefreshPolicy,
  FakePasswordHasher,
  FakeTokenService,
  FixedAuthTokenTtl,
  InMemoryLoginOrganizationReader,
  InMemoryEmployeeAccessResolver,
} from './support/in-memory-registration.dependencies';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

/**
 * MANDATORY ROLLBACK VERIFICATION (Phase 2.12).
 *
 * Every flow below drives the REAL use case through the REAL `PrismaUnitOfWork`
 * (real `prisma.$transaction`) with REAL Prisma-backed repositories for every
 * step, except one repository method — the last write in that use case's
 * transaction body — which is replaced with a stub that throws. Every other
 * method on that repository still delegates to the real Prisma-backed
 * implementation. This proves that when Postgres receives a genuine thrown
 * error mid-transaction, every prior write inside that same transaction is
 * actually rolled back on the real database, not just "would be rolled back
 * in principle" per in-memory unit tests.
 */

const prisma = new PrismaClient();
const TEST_PREFIX = 'rollback-injection-';
const opaqueTokenService = new Sha256OpaqueTokenService();
const INJECTED_FAILURE = 'INJECTED_ROLLBACK_FAILURE';

describe('PostgreSQL transaction rollback injection (integration)', () => {
  let dbAvailable = false;
  let userRepository: PrismaUserRepository;
  let deviceSessionRepository: PrismaDeviceSessionRepository;
  let tokenFamilyRepository: PrismaTokenFamilyRepository;
  let passwordHistoryRepository: PrismaPasswordHistoryRepository;
  let passwordResetRepository: PrismaPasswordResetRepository;
  let systemConfiguration: PrismaSystemConfiguration;
  let unitOfWork: PrismaUnitOfWork;
  const passwordHasher = new FakePasswordHasher();

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([
      PrismaUserRepository,
      PrismaDeviceSessionRepository,
      PrismaTokenFamilyRepository,
      PrismaPasswordHistoryRepository,
      PrismaPasswordResetRepository,
      PrismaSystemConfiguration,
      PrismaUnitOfWork,
    ]);

    userRepository = moduleRef.get(PrismaUserRepository);
    deviceSessionRepository = moduleRef.get(PrismaDeviceSessionRepository);
    tokenFamilyRepository = moduleRef.get(PrismaTokenFamilyRepository);
    passwordHistoryRepository = moduleRef.get(PrismaPasswordHistoryRepository);
    passwordResetRepository = moduleRef.get(PrismaPasswordResetRepository);
    systemConfiguration = moduleRef.get(PrismaSystemConfiguration);
    unitOfWork = moduleRef.get(PrismaUnitOfWork);
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
    await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
    await prisma.$disconnect();
  });

  it('Refresh (replay/reuse detection): rolls back TokenFamily compromise when session revocation fails', async () => {
    if (!dbAvailable) return;

    const userId = randomUUID();
    const email = `${TEST_PREFIX}refresh-${userId}@example.com`;
    const sessionId = randomUUID();
    const familyId = randomUUID();
    const currentHash = opaqueTokenService.hash(`current-${sessionId}`);
    const presentedRawToken = `previous-${sessionId}`;
    const previousHash = opaqueTokenService.hash(presentedRawToken);

    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Refresh',
        lastName: 'Rollback',
        email,
        passwordHash: 'argon2id$placeholder',
        language: 'en',
        status: PrismaUserStatus.Active,
        emailVerified: true,
      },
    });
    await prisma.tokenFamily.create({ data: { id: familyId, userId } });
    await prisma.deviceSession.create({
      data: {
        id: sessionId,
        userId,
        tokenFamilyId: familyId,
        refreshTokenHash: currentHash,
        previousRefreshTokenHash: previousHash,
        deviceType: 'web',
        sessionVersion: 1,
        permissionsVersion: 1,
        // Well past any concurrent-refresh grace window, so presenting the
        // previous hash is unambiguously treated as replay, not a benign race.
        lastUsedAt: new Date(Date.now() - 10 * 60_000),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    const failingDeviceSessionRepository: DeviceSessionRepository = {
      findById: deviceSessionRepository.findById.bind(deviceSessionRepository),
      findByRefreshTokenHash:
        deviceSessionRepository.findByRefreshTokenHash.bind(deviceSessionRepository),
      findByPreviousRefreshTokenHash:
        deviceSessionRepository.findByPreviousRefreshTokenHash.bind(deviceSessionRepository),
      countActiveByUserId:
        deviceSessionRepository.countActiveByUserId.bind(deviceSessionRepository),
      findActiveByUserId: deviceSessionRepository.findActiveByUserId.bind(deviceSessionRepository),
      save: deviceSessionRepository.save.bind(deviceSessionRepository),
      rotateRefreshTokenIfHashMatches:
        deviceSessionRepository.rotateRefreshTokenIfHashMatches.bind(deviceSessionRepository),
      revokeAllByUserId: deviceSessionRepository.revokeAllByUserId.bind(deviceSessionRepository),
      revokeAllByUserIdExceptSession:
        deviceSessionRepository.revokeAllByUserIdExceptSession.bind(deviceSessionRepository),
      updateSessionVersionIfActive:
        deviceSessionRepository.updateSessionVersionIfActive.bind(deviceSessionRepository),
      revokeByIdIfOwnedByUser:
        deviceSessionRepository.revokeByIdIfOwnedByUser.bind(deviceSessionRepository),
      revokeAllByTokenFamilyId: async () => {
        throw new Error(INJECTED_FAILURE);
      },
    };

    const eventPublisher = new CollectingEventPublisher();
    const useCase = new RefreshSessionUseCase(
      userRepository,
      failingDeviceSessionRepository,
      tokenFamilyRepository,
      opaqueTokenService,
      {
        signAccessToken: () => 'unused',
        verifyAccessToken: () => {
          throw new Error('unused');
        },
      },
      unitOfWork,
      eventPublisher,
      new FixedClock(new Date()),
      new UuidGenerator(),
      systemConfiguration,
      { accessTokenTtlSeconds: 900 },
      new FixedAuthRefreshPolicy(30_000),
      new InMemoryLoginOrganizationReader(),
      new InMemoryEmployeeAccessResolver(),
    );

    await expect(
      useCase.execute({ refreshToken: presentedRawToken, ipAddress: '127.0.0.1' }),
    ).rejects.toThrow(INJECTED_FAILURE);
    expect(eventPublisher.events).toHaveLength(0);

    const familyRow = await prisma.tokenFamily.findUnique({ where: { id: familyId } });
    expect(familyRow?.compromisedAt).toBeNull();

    const sessionRow = await prisma.deviceSession.findUnique({ where: { id: sessionId } });
    expect(sessionRow?.revokedAt).toBeNull();
  });

  it('Logout All: rolls back the SessionVersion bump when TokenFamily revocation fails', async () => {
    if (!dbAvailable) return;

    const userId = randomUUID();
    const email = `${TEST_PREFIX}logout-all-${userId}@example.com`;
    const sessionId = randomUUID();
    const familyId = randomUUID();

    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'LogoutAll',
        lastName: 'Rollback',
        email,
        passwordHash: 'argon2id$placeholder',
        language: 'en',
        status: PrismaUserStatus.Active,
        emailVerified: true,
        sessionVersion: 1,
      },
    });
    await prisma.tokenFamily.create({ data: { id: familyId, userId } });
    await prisma.deviceSession.create({
      data: {
        id: sessionId,
        userId,
        tokenFamilyId: familyId,
        refreshTokenHash: opaqueTokenService.hash(`la-${sessionId}`),
        deviceType: 'web',
        sessionVersion: 1,
        permissionsVersion: 1,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    const failingTokenFamilyRepository: TokenFamilyRepository = {
      findById: tokenFamilyRepository.findById.bind(tokenFamilyRepository),
      save: tokenFamilyRepository.save.bind(tokenFamilyRepository),
      revokeAllByUserIdExceptFamily:
        tokenFamilyRepository.revokeAllByUserIdExceptFamily.bind(tokenFamilyRepository),
      markCompromisedIfActive:
        tokenFamilyRepository.markCompromisedIfActive.bind(tokenFamilyRepository),
      revokeAllByUserId: async () => {
        throw new Error(INJECTED_FAILURE);
      },
    };

    const eventPublisher = new CollectingEventPublisher();
    const useCase = new LogoutAllDevicesUseCase(
      userRepository,
      deviceSessionRepository,
      failingTokenFamilyRepository,
      unitOfWork,
      eventPublisher,
      new FixedClock(new Date()),
      new UuidGenerator(),
    );

    await expect(
      useCase.execute({
        actor: {
          actorType: AccessTokenActorType.User,
          userId,
          sessionId,
          sessionVersion: 1,
          tokenFamilyId: familyId,
        },
      }),
    ).rejects.toThrow(INJECTED_FAILURE);
    expect(eventPublisher.events).toHaveLength(0);

    const userRow = await prisma.user.findUnique({ where: { id: userId } });
    expect(userRow?.sessionVersion).toBe(1);

    const sessionRow = await prisma.deviceSession.findUnique({ where: { id: sessionId } });
    expect(sessionRow?.revokedAt).toBeNull();
  });

  it('Reset Password: rolls back password hash + history + session revocation when TokenFamily revocation fails', async () => {
    if (!dbAvailable) return;

    const userId = randomUUID();
    const email = `${TEST_PREFIX}reset-${userId}@example.com`;
    const sessionId = randomUUID();
    const familyId = randomUUID();
    const currentHash = 'argon2id$reset-current-hash';
    const rawResetToken = `reset-${userId}`;
    const resetTokenHash = opaqueTokenService.hash(rawResetToken);
    const resetTokenId = randomUUID();

    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Reset',
        lastName: 'Rollback',
        email,
        passwordHash: currentHash,
        language: 'en',
        status: PrismaUserStatus.Active,
        emailVerified: true,
      },
    });
    await prisma.tokenFamily.create({ data: { id: familyId, userId } });
    await prisma.deviceSession.create({
      data: {
        id: sessionId,
        userId,
        tokenFamilyId: familyId,
        refreshTokenHash: opaqueTokenService.hash(`reset-session-${sessionId}`),
        deviceType: 'web',
        sessionVersion: 1,
        permissionsVersion: 1,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    await passwordResetRepository.save({
      id: resetTokenId,
      userId,
      tokenHash: resetTokenHash,
      expiresAt: new Date(Date.now() + 3_600_000),
      consumedAt: null,
      createdAt: new Date(),
    });

    const failingTokenFamilyRepository: TokenFamilyRepository = {
      findById: tokenFamilyRepository.findById.bind(tokenFamilyRepository),
      save: tokenFamilyRepository.save.bind(tokenFamilyRepository),
      revokeAllByUserIdExceptFamily:
        tokenFamilyRepository.revokeAllByUserIdExceptFamily.bind(tokenFamilyRepository),
      markCompromisedIfActive:
        tokenFamilyRepository.markCompromisedIfActive.bind(tokenFamilyRepository),
      revokeAllByUserId: async () => {
        throw new Error(INJECTED_FAILURE);
      },
    };

    const eventPublisher = new CollectingEventPublisher();
    const useCase = new ResetPasswordUseCase(
      userRepository,
      passwordResetRepository,
      passwordHistoryRepository,
      deviceSessionRepository,
      failingTokenFamilyRepository,
      passwordHasher,
      opaqueTokenService,
      unitOfWork,
      eventPublisher,
      new FixedClock(new Date()),
      new UuidGenerator(),
      systemConfiguration,
    );

    await expect(
      useCase.execute({ token: rawResetToken, newPassword: 'BrandNewPass1!' }),
    ).rejects.toThrow(INJECTED_FAILURE);
    expect(eventPublisher.events).toHaveLength(0);

    const resetTokenRow = await prisma.passwordResetToken.findUnique({
      where: { id: resetTokenId },
    });
    expect(resetTokenRow?.consumedAt).toBeNull();

    const userRow = await prisma.user.findUnique({ where: { id: userId } });
    expect(userRow?.passwordHash).toBe(currentHash);

    const historyCount = await prisma.passwordHistory.count({ where: { userId } });
    expect(historyCount).toBe(0);

    const sessionRow = await prisma.deviceSession.findUnique({ where: { id: sessionId } });
    expect(sessionRow?.revokedAt).toBeNull();
  });

  it('Change Password: rolls back password hash + other-session revocation when the current-session snapshot update fails', async () => {
    if (!dbAvailable) return;

    const userId = randomUUID();
    const email = `${TEST_PREFIX}change-${userId}@example.com`;
    const currentSessionId = randomUUID();
    const otherSessionId = randomUUID();
    const currentFamilyId = randomUUID();
    const otherFamilyId = randomUUID();
    const currentPasswordPlain = 'CurrentPass1!Strong';
    const currentHash = await passwordHasher.hash(Password.create(currentPasswordPlain));

    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Change',
        lastName: 'Rollback',
        email,
        passwordHash: currentHash.value,
        language: 'en',
        status: PrismaUserStatus.Active,
        emailVerified: true,
        sessionVersion: 1,
      },
    });
    for (const [familyId, sessionId] of [
      [currentFamilyId, currentSessionId],
      [otherFamilyId, otherSessionId],
    ] as const) {
      await prisma.tokenFamily.create({ data: { id: familyId, userId } });
      await prisma.deviceSession.create({
        data: {
          id: sessionId,
          userId,
          tokenFamilyId: familyId,
          refreshTokenHash: opaqueTokenService.hash(`change-${sessionId}`),
          deviceType: 'web',
          sessionVersion: 1,
          permissionsVersion: 1,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
    }

    const failingDeviceSessionRepository: DeviceSessionRepository = {
      findById: deviceSessionRepository.findById.bind(deviceSessionRepository),
      findByRefreshTokenHash:
        deviceSessionRepository.findByRefreshTokenHash.bind(deviceSessionRepository),
      findByPreviousRefreshTokenHash:
        deviceSessionRepository.findByPreviousRefreshTokenHash.bind(deviceSessionRepository),
      countActiveByUserId:
        deviceSessionRepository.countActiveByUserId.bind(deviceSessionRepository),
      findActiveByUserId: deviceSessionRepository.findActiveByUserId.bind(deviceSessionRepository),
      save: deviceSessionRepository.save.bind(deviceSessionRepository),
      rotateRefreshTokenIfHashMatches:
        deviceSessionRepository.rotateRefreshTokenIfHashMatches.bind(deviceSessionRepository),
      revokeAllByUserId: deviceSessionRepository.revokeAllByUserId.bind(deviceSessionRepository),
      revokeAllByUserIdExceptSession:
        deviceSessionRepository.revokeAllByUserIdExceptSession.bind(deviceSessionRepository),
      revokeAllByTokenFamilyId:
        deviceSessionRepository.revokeAllByTokenFamilyId.bind(deviceSessionRepository),
      revokeByIdIfOwnedByUser:
        deviceSessionRepository.revokeByIdIfOwnedByUser.bind(deviceSessionRepository),
      updateSessionVersionIfActive: async () => {
        throw new Error(INJECTED_FAILURE);
      },
    };

    const eventPublisher = new CollectingEventPublisher();
    const useCase = new ChangePasswordUseCase(
      userRepository,
      passwordHistoryRepository,
      passwordResetRepository,
      failingDeviceSessionRepository,
      tokenFamilyRepository,
      passwordHasher,
      unitOfWork,
      eventPublisher,
      new FixedClock(new Date()),
      new UuidGenerator(),
      systemConfiguration,
      new FakeTokenService(),
      new FixedAuthTokenTtl(900),
    );

    await expect(
      useCase.execute({
        actor: {
          actorType: AccessTokenActorType.User,
          userId,
          sessionId: currentSessionId,
          sessionVersion: 1,
          tokenFamilyId: currentFamilyId,
        },
        currentPassword: currentPasswordPlain,
        newPassword: 'BrandNewChangePass1!',
      }),
    ).rejects.toThrow(INJECTED_FAILURE);
    expect(eventPublisher.events).toHaveLength(0);

    const userRow = await prisma.user.findUnique({ where: { id: userId } });
    expect(userRow?.passwordHash).toBe(currentHash.value);
    expect(userRow?.sessionVersion).toBe(1);

    const historyCount = await prisma.passwordHistory.count({ where: { userId } });
    expect(historyCount).toBe(0);

    const otherSessionRow = await prisma.deviceSession.findUnique({
      where: { id: otherSessionId },
    });
    expect(otherSessionRow?.revokedAt).toBeNull();

    const currentSessionRow = await prisma.deviceSession.findUnique({
      where: { id: currentSessionId },
    });
    expect(currentSessionRow?.sessionVersion).toBe(1);
  });
});
