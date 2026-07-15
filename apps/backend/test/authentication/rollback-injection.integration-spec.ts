import { PrismaClient, UserStatus as PrismaUserStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { RegisterOrganizationOwnerUseCase } from '@modules/authentication/application/use-cases/register-organization-owner.use-case';
import { VerifyEmailUseCase } from '@modules/authentication/application/use-cases/verify-email.use-case';
import { RefreshSessionUseCase } from '@modules/authentication/application/use-cases/refresh-session.use-case';
import { LogoutAllDevicesUseCase } from '@modules/authentication/application/use-cases/logout-all-devices.use-case';
import { ResetPasswordUseCase } from '@modules/authentication/application/use-cases/reset-password.use-case';
import { ChangePasswordUseCase } from '@modules/authentication/application/use-cases/change-password.use-case';
import { PrismaUserRepository } from '@modules/authentication/infrastructure/persistence/prisma-user.repository';
import { PrismaEmailVerificationRepository } from '@modules/authentication/infrastructure/persistence/prisma-user.repository';
import { PrismaDeviceSessionRepository } from '@modules/authentication/infrastructure/persistence/prisma-device-session.repository';
import { PrismaTokenFamilyRepository } from '@modules/authentication/infrastructure/persistence/prisma-token-family.repository';
import { PrismaPasswordHistoryRepository } from '@modules/authentication/infrastructure/persistence/prisma-password-history.repository';
import { PrismaPasswordResetRepository } from '@modules/authentication/infrastructure/persistence/prisma-password-reset.repository';
import { PrismaSystemConfiguration } from '@modules/authentication/infrastructure/persistence/prisma-system-configuration';
import { PrismaUnitOfWork } from '@modules/authentication/infrastructure/persistence/prisma-unit-of-work';
import { PrismaUserConsentRepository } from '@modules/authentication/infrastructure/persistence/prisma-user-consent.repository';
import { PrismaOrganizationRepository } from '@modules/organizations/infrastructure/persistence/prisma-organization.repository';
import { PrismaOrganizationMemberRepository } from '@modules/organizations/infrastructure/persistence/prisma-organization-member.repository';
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';
import { Sha256OpaqueTokenService } from '@modules/authentication/infrastructure/security/sha256-opaque-token.service';
import {
  DeviceSessionRepository,
  EmailVerificationRepository,
  TokenFamilyRepository,
  UserRepository,
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
 * in principle" per in-memory unit tests (see
 * register-organization-owner.integration-spec.ts, which only exercises an
 * in-memory snapshot/restore UnitOfWork).
 */

const prisma = new PrismaClient();
const TEST_PREFIX = 'rollback-injection-';
const opaqueTokenService = new Sha256OpaqueTokenService();
const INJECTED_FAILURE = 'INJECTED_ROLLBACK_FAILURE';

describe('PostgreSQL transaction rollback injection (integration)', () => {
  let dbAvailable = false;
  let userRepository: PrismaUserRepository;
  let emailVerificationRepository: PrismaEmailVerificationRepository;
  let deviceSessionRepository: PrismaDeviceSessionRepository;
  let tokenFamilyRepository: PrismaTokenFamilyRepository;
  let passwordHistoryRepository: PrismaPasswordHistoryRepository;
  let passwordResetRepository: PrismaPasswordResetRepository;
  let systemConfiguration: PrismaSystemConfiguration;
  let unitOfWork: PrismaUnitOfWork;
  let userConsentRepository: PrismaUserConsentRepository;
  let organizationRepository: PrismaOrganizationRepository;
  let organizationMemberRepository: PrismaOrganizationMemberRepository;
  let tenantContextService: TenantContextService;
  const passwordHasher = new FakePasswordHasher();

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([
      PrismaUserRepository,
      PrismaEmailVerificationRepository,
      PrismaDeviceSessionRepository,
      PrismaTokenFamilyRepository,
      PrismaPasswordHistoryRepository,
      PrismaPasswordResetRepository,
      PrismaSystemConfiguration,
      PrismaUnitOfWork,
      PrismaUserConsentRepository,
      PrismaOrganizationRepository,
      PrismaOrganizationMemberRepository,
    ]);

    userRepository = moduleRef.get(PrismaUserRepository);
    emailVerificationRepository = moduleRef.get(PrismaEmailVerificationRepository);
    deviceSessionRepository = moduleRef.get(PrismaDeviceSessionRepository);
    tokenFamilyRepository = moduleRef.get(PrismaTokenFamilyRepository);
    passwordHistoryRepository = moduleRef.get(PrismaPasswordHistoryRepository);
    passwordResetRepository = moduleRef.get(PrismaPasswordResetRepository);
    systemConfiguration = moduleRef.get(PrismaSystemConfiguration);
    unitOfWork = moduleRef.get(PrismaUnitOfWork);
    userConsentRepository = moduleRef.get(PrismaUserConsentRepository);
    organizationRepository = moduleRef.get(PrismaOrganizationRepository);
    organizationMemberRepository = moduleRef.get(PrismaOrganizationMemberRepository);
    tenantContextService = moduleRef.get(TenantContextService);
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
    await prisma.emailVerificationToken.deleteMany({
      where: { user: { email: { startsWith: TEST_PREFIX } } },
    });
    await prisma.userConsent.deleteMany({
      where: { user: { email: { startsWith: TEST_PREFIX } } },
    });
    await prisma.organizationMember.deleteMany({
      where: { user: { email: { startsWith: TEST_PREFIX } } },
    });
    await prisma.organization.deleteMany({
      where: { slug: { startsWith: TEST_PREFIX } },
    });
    await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
    await prisma.$disconnect();
  });

  it('Registration: rolls back User + Organization + OrganizationMember + UserConsent + EmailVerificationToken writes when the last transaction step fails', async () => {
    if (!dbAvailable) return;

    const email = `${TEST_PREFIX}register-${randomUUID()}@example.com`;
    const organizationSlug = `${TEST_PREFIX}register-${randomUUID()}`;

    // Every dependency below is now a real Prisma-backed repository — no
    // in-memory stand-ins remain on the Registration persistence path (see
    // PrismaOrganizationRepository, PrismaOrganizationMemberRepository,
    // PrismaUserConsentRepository). Only the last transaction step
    // (EmailVerificationToken.save) is stubbed to throw, so this proves the
    // real Postgres transaction rolls back every prior real write —
    // including Organization/OrganizationMember/UserConsent, which previously
    // had no Prisma repository to verify against real Postgres at all.
    const failingEmailVerificationRepository: EmailVerificationRepository = {
      findByTokenHash: emailVerificationRepository.findByTokenHash.bind(
        emailVerificationRepository,
      ),
      findActiveByUserId: emailVerificationRepository.findActiveByUserId.bind(
        emailVerificationRepository,
      ),
      invalidateActiveByUserId: emailVerificationRepository.invalidateActiveByUserId.bind(
        emailVerificationRepository,
      ),
      consumeIfActive: emailVerificationRepository.consumeIfActive.bind(
        emailVerificationRepository,
      ),
      save: async () => {
        throw new Error(INJECTED_FAILURE);
      },
    };

    const eventPublisher = new CollectingEventPublisher();
    const useCase = new RegisterOrganizationOwnerUseCase(
      userRepository,
      organizationRepository,
      organizationMemberRepository,
      failingEmailVerificationRepository,
      userConsentRepository,
      passwordHasher,
      opaqueTokenService,
      unitOfWork,
      eventPublisher,
      new FixedClock(new Date()),
      new UuidGenerator(),
      systemConfiguration,
      tenantContextService,
    );

    await expect(
      useCase.execute({
        email,
        password: 'RollbackTest1Pass!',
        firstName: 'Rollback',
        lastName: 'Test',
        organizationName: `Rollback Org ${randomUUID()}`,
        organizationSlug,
        consents: { termsOfService: true, privacyPolicy: true },
        ipAddress: '127.0.0.1',
      }),
    ).rejects.toThrow(INJECTED_FAILURE);

    // Phase 2.19: events must never be published when the transaction rolls
    // back - proven directly here, not just inferred from code structure.
    expect(eventPublisher.events).toHaveLength(0);

    const persistedUser = await prisma.user.findFirst({ where: { email } });
    expect(persistedUser).toBeNull();

    const tokenCount = await prisma.emailVerificationToken.count({
      where: { user: { email } },
    });
    expect(tokenCount).toBe(0);

    const organizationCount = await prisma.organization.count({
      where: { slug: organizationSlug },
    });
    expect(organizationCount).toBe(0);

    const consentCount = await prisma.userConsent.count({
      where: { user: { email } },
    });
    expect(consentCount).toBe(0);
  });

  it('Email Verification: rolls back token consumption when the User save fails', async () => {
    if (!dbAvailable) return;

    const userId = randomUUID();
    const email = `${TEST_PREFIX}verify-${userId}@example.com`;
    const tokenId = randomUUID();
    const rawToken = `verify-token-${userId}`;
    const tokenHash = opaqueTokenService.hash(rawToken);

    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Verify',
        lastName: 'Rollback',
        email,
        passwordHash: 'argon2id$placeholder',
        language: 'en',
        status: PrismaUserStatus.Pending,
        emailVerified: false,
      },
    });
    await prisma.emailVerificationToken.create({
      data: {
        id: tokenId,
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + 3_600_000),
        consumedAt: null,
      },
    });

    const failingUserRepository: UserRepository = {
      findById: userRepository.findById.bind(userRepository),
      findByEmail: userRepository.findByEmail.bind(userRepository),
      existsByEmail: userRepository.existsByEmail.bind(userRepository),
      incrementSessionVersion: userRepository.incrementSessionVersion.bind(userRepository),
      updatePasswordIfCurrentHashMatches:
        userRepository.updatePasswordIfCurrentHashMatches.bind(userRepository),
      getAvatarId: userRepository.getAvatarId.bind(userRepository),
      updateAvatarId: userRepository.updateAvatarId.bind(userRepository),
      save: async () => {
        throw new Error(INJECTED_FAILURE);
      },
    };

    const eventPublisher = new CollectingEventPublisher();
    const useCase = new VerifyEmailUseCase(
      failingUserRepository,
      emailVerificationRepository,
      opaqueTokenService,
      unitOfWork,
      eventPublisher,
      new FixedClock(new Date()),
      new UuidGenerator(),
    );

    await expect(useCase.execute({ token: rawToken })).rejects.toThrow(INJECTED_FAILURE);
    expect(eventPublisher.events).toHaveLength(0);

    const tokenRow = await prisma.emailVerificationToken.findUnique({ where: { id: tokenId } });
    expect(tokenRow?.consumedAt).toBeNull();

    const userRow = await prisma.user.findUnique({ where: { id: userId } });
    expect(userRow?.emailVerified).toBe(false);
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
