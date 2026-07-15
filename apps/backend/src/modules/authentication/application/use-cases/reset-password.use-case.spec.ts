import { ResetPasswordUseCase } from './reset-password.use-case';
import { RegistrationPolicy } from '../../domain/services/registration-policy';
import { Email } from '@shared/domain/value-objects/email.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { WeakPasswordException } from '@shared/domain/value-objects/password.vo';
import { DeviceType } from '../../domain/enums/authentication.enums';
import {
  PasswordResetCompletedEvent,
  SessionRevokedEvent,
} from '../../domain/events/authentication.events';
import { PasswordReusedException } from '../../domain/exceptions/password-reused.exception';
import { InvalidResetTokenException } from '../exceptions/invalid-reset-token.exception';
import { ExpiredResetTokenException } from '../exceptions/expired-reset-token.exception';
import { SYSTEM_CONFIG_KEYS } from '@shared/application/ports/system-configuration.port';
import { User } from '../../domain/entities/user.entity';
import { DeviceSession } from '../../domain/entities/device-session.entity';
import { SessionPolicy } from '../../domain/services/authentication-policies';
import {
  CollectingEventPublisher,
  FakeOpaqueTokenService,
  FakePasswordHasher,
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryDeviceSessionRepository,
  InMemoryPasswordHistoryRepository,
  InMemoryPasswordResetRepository,
  InMemorySystemConfiguration,
  InMemoryTokenFamilyRepository,
  InMemoryUserRepository,
  UuidGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('ResetPasswordUseCase', () => {
  const fixedNow = new Date('2026-07-07T12:00:00.000Z');
  const userId = '11111111-1111-4111-8111-111111111111';
  const tokenId = '22222222-2222-4222-8222-222222222222';
  const sessionId = '33333333-3333-4333-8333-333333333333';
  const tokenFamilyId = '44444444-4444-4444-8444-444444444444';
  const opaqueToken = 'reset-token-value';
  const oldPassword = 'SecurePass123!';
  const newPassword = 'BrandNewPass1!';

  function createActiveUser(overrides?: Partial<ReturnType<User['toProps']>>): User {
    const base = RegistrationPolicy.createPendingUser({
      id: userId,
      email: Email.create('reset@example.com'),
      passwordHash: PasswordHash.create(`argon2id$fake$${oldPassword}`),
      firstName: 'Reset',
      lastName: 'User',
      phone: null,
      language: 'en',
      at: fixedNow,
    }).verifyEmail(fixedNow);

    return User.reconstitute({ ...base.toProps(), ...overrides });
  }

  function seedValidToken(passwordResetRepository: InMemoryPasswordResetRepository) {
    const opaque = new FakeOpaqueTokenService();
    passwordResetRepository.tokens.push({
      id: tokenId,
      userId,
      tokenHash: opaque.hash(opaqueToken),
      expiresAt: new Date(fixedNow.getTime() + 3_600_000),
      consumedAt: null,
      createdAt: fixedNow,
    });
  }

  async function seedActiveSession(deviceSessionRepository: InMemoryDeviceSessionRepository) {
    const refreshExpiry = SessionPolicy.calculateRefreshExpiry(fixedNow, 30);
    await deviceSessionRepository.save(
      DeviceSession.create({
        id: sessionId,
        userId,
        tokenFamilyId,
        refreshTokenHash: 'sha256-refresh',
        previousRefreshTokenHash: null,
        deviceName: 'Chrome',
        deviceType: DeviceType.Web,
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
        sessionVersion: 1,
        permissionsVersion: 1,
        createdAt: fixedNow,
        lastUsedAt: fixedNow,
        expiresAt: refreshExpiry,
        revokedAt: null,
        revokedReason: null,
      }),
    );
  }

  function createUseCase(overrides?: {
    userRepository?: InMemoryUserRepository;
    passwordResetRepository?: InMemoryPasswordResetRepository;
    passwordHistoryRepository?: InMemoryPasswordHistoryRepository;
    deviceSessionRepository?: InMemoryDeviceSessionRepository;
    tokenFamilyRepository?: InMemoryTokenFamilyRepository;
    eventPublisher?: CollectingEventPublisher;
    passwordHasher?: FakePasswordHasher;
  }) {
    const userRepository = overrides?.userRepository ?? new InMemoryUserRepository();
    const passwordResetRepository =
      overrides?.passwordResetRepository ?? new InMemoryPasswordResetRepository();
    const passwordHistoryRepository =
      overrides?.passwordHistoryRepository ?? new InMemoryPasswordHistoryRepository();
    const deviceSessionRepository =
      overrides?.deviceSessionRepository ?? new InMemoryDeviceSessionRepository();
    const tokenFamilyRepository =
      overrides?.tokenFamilyRepository ?? new InMemoryTokenFamilyRepository();
    const eventPublisher = overrides?.eventPublisher ?? new CollectingEventPublisher();

    const useCase = new ResetPasswordUseCase(
      userRepository,
      passwordResetRepository,
      passwordHistoryRepository,
      deviceSessionRepository,
      tokenFamilyRepository,
      overrides?.passwordHasher ?? new FakePasswordHasher(),
      new FakeOpaqueTokenService(),
      new ImmediateUnitOfWork(),
      eventPublisher,
      new FixedClock(fixedNow),
      new UuidGenerator(),
      new InMemorySystemConfiguration({
        [SYSTEM_CONFIG_KEYS.passwordHistoryCount]: 5,
      }),
    );

    return {
      useCase,
      userRepository,
      passwordResetRepository,
      passwordHistoryRepository,
      deviceSessionRepository,
      tokenFamilyRepository,
      eventPublisher,
    };
  }

  it('resets password, revokes sessions, and publishes events', async () => {
    const {
      useCase,
      userRepository,
      passwordResetRepository,
      passwordHistoryRepository,
      deviceSessionRepository,
      eventPublisher,
    } = createUseCase();
    await userRepository.save(createActiveUser({ sessionVersion: 1 }));
    seedValidToken(passwordResetRepository);
    await seedActiveSession(deviceSessionRepository);

    const result = await useCase.execute({ token: opaqueToken, newPassword });

    expect(result.message).toBe('Password reset successfully.');
    const updatedUser = (await userRepository.findById(createActiveUser().userId))!;
    expect(updatedUser.passwordHash.value).toBe(`argon2id$fake$${newPassword}`);
    expect(updatedUser.sessionVersion).toBe(2);
    expect(passwordHistoryRepository.history).toHaveLength(1);
    expect(passwordHistoryRepository.history[0].passwordHash).toBe(`argon2id$fake$${oldPassword}`);
    expect(deviceSessionRepository.sessions[0].toProps().revokedAt).not.toBeNull();
    expect(
      eventPublisher.events.some((event) => event instanceof PasswordResetCompletedEvent),
    ).toBe(true);
    expect(eventPublisher.events.some((event) => event instanceof SessionRevokedEvent)).toBe(true);
  });

  it('rejects invalid tokens with generic error', async () => {
    const { useCase } = createUseCase();
    await expect(useCase.execute({ token: 'unknown-token', newPassword })).rejects.toBeInstanceOf(
      InvalidResetTokenException,
    );
  });

  it('rejects expired tokens', async () => {
    const passwordResetRepository = new InMemoryPasswordResetRepository();
    const opaque = new FakeOpaqueTokenService();
    passwordResetRepository.tokens.push({
      id: tokenId,
      userId,
      tokenHash: opaque.hash(opaqueToken),
      expiresAt: new Date(fixedNow.getTime() - 1_000),
      consumedAt: null,
      createdAt: fixedNow,
    });
    const { useCase, userRepository } = createUseCase({ passwordResetRepository });
    await userRepository.save(createActiveUser());

    await expect(useCase.execute({ token: opaqueToken, newPassword })).rejects.toBeInstanceOf(
      ExpiredResetTokenException,
    );
  });

  it('rejects consumed tokens', async () => {
    const passwordResetRepository = new InMemoryPasswordResetRepository();
    const opaque = new FakeOpaqueTokenService();
    passwordResetRepository.tokens.push({
      id: tokenId,
      userId,
      tokenHash: opaque.hash(opaqueToken),
      expiresAt: new Date(fixedNow.getTime() + 3_600_000),
      consumedAt: fixedNow,
      createdAt: fixedNow,
    });
    const { useCase, userRepository } = createUseCase({ passwordResetRepository });
    await userRepository.save(createActiveUser());

    await expect(useCase.execute({ token: opaqueToken, newPassword })).rejects.toBeInstanceOf(
      InvalidResetTokenException,
    );
  });

  it('rejects weak passwords', async () => {
    const { useCase, userRepository, passwordResetRepository } = createUseCase();
    await userRepository.save(createActiveUser());
    seedValidToken(passwordResetRepository);

    await expect(
      useCase.execute({ token: opaqueToken, newPassword: 'short' }),
    ).rejects.toBeInstanceOf(WeakPasswordException);
  });

  it('rejects password reuse against current and historical hashes', async () => {
    const passwordHistoryRepository = new InMemoryPasswordHistoryRepository();
    passwordHistoryRepository.history.push({
      id: 'history-1',
      userId,
      passwordHash: 'argon2id$fake$OldHistoryPass1!',
      createdAt: fixedNow,
    });
    const passwordHasher = new FakePasswordHasher();
    const { useCase, userRepository, passwordResetRepository } = createUseCase({
      passwordHistoryRepository,
      passwordHasher,
    });
    await userRepository.save(createActiveUser());
    seedValidToken(passwordResetRepository);

    await expect(
      useCase.execute({ token: opaqueToken, newPassword: oldPassword }),
    ).rejects.toBeInstanceOf(PasswordReusedException);

    await expect(
      useCase.execute({ token: opaqueToken, newPassword: 'OldHistoryPass1!' }),
    ).rejects.toBeInstanceOf(PasswordReusedException);
  });

  it('fails safely when token consumption races', async () => {
    const passwordResetRepository = new InMemoryPasswordResetRepository();
    const originalConsume = passwordResetRepository.consumeIfActive.bind(passwordResetRepository);
    let consumeCount = 0;
    passwordResetRepository.consumeIfActive = async (id, consumedAt) => {
      consumeCount += 1;
      if (consumeCount === 1) {
        return originalConsume(id, consumedAt);
      }
      return false;
    };

    const { useCase, userRepository } = createUseCase({ passwordResetRepository });
    await userRepository.save(createActiveUser());
    seedValidToken(passwordResetRepository);

    await useCase.execute({ token: opaqueToken, newPassword });
    await expect(
      useCase.execute({ token: opaqueToken, newPassword: 'AnotherPass123!' }),
    ).rejects.toBeInstanceOf(InvalidResetTokenException);
  });

  it('invalidates remaining reset tokens after success', async () => {
    const passwordResetRepository = new InMemoryPasswordResetRepository();
    const { useCase, userRepository } = createUseCase({ passwordResetRepository });
    await userRepository.save(createActiveUser());
    seedValidToken(passwordResetRepository);
    passwordResetRepository.tokens.push({
      id: 'other-token',
      userId,
      tokenHash: 'sha256-other',
      expiresAt: new Date(fixedNow.getTime() + 3_600_000),
      consumedAt: null,
      createdAt: fixedNow,
    });

    await useCase.execute({ token: opaqueToken, newPassword });

    const activeTokens = passwordResetRepository.tokens.filter(
      (token) => token.consumedAt === null,
    );
    expect(activeTokens).toHaveLength(0);
  });
});
