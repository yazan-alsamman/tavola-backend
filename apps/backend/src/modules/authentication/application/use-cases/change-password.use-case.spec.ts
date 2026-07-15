import { ChangePasswordUseCase } from './change-password.use-case';
import { AuthenticatedUserActor } from '../dto/authenticated-actor.dto';
import { RegistrationPolicy } from '../../domain/services/registration-policy';
import { Email } from '@shared/domain/value-objects/email.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { WeakPasswordException } from '@shared/domain/value-objects/password.vo';
import { DeviceType, UserStatus } from '../../domain/enums/authentication.enums';
import {
  PasswordChangedEvent,
  SessionRevokedEvent,
} from '../../domain/events/authentication.events';
import { PasswordReusedException } from '../../domain/exceptions/password-reused.exception';
import { AccountSuspendedException } from '../../domain/exceptions/account-suspended.exception';
import { InvalidCredentialsException } from '../exceptions/login.exceptions';
import { InvalidAccessTokenException } from '../exceptions/access-token.exceptions';
import { AccessTokenActorType } from '../../domain/services/access-token-claims';
import { User } from '../../domain/entities/user.entity';
import { DeviceSession } from '../../domain/entities/device-session.entity';
import { TokenFamily } from '../../domain/entities/token-family.entity';
import { SessionPolicy } from '../../domain/services/authentication-policies';
import { SYSTEM_CONFIG_KEYS } from '@shared/application/ports/system-configuration.port';
import { UnitOfWorkPort } from '@shared/application/ports/unit-of-work.port';
import {
  CollectingEventPublisher,
  FakePasswordHasher,
  FakeTokenService,
  FixedAuthTokenTtl,
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

class FailingUnitOfWork implements UnitOfWorkPort {
  async execute<T>(_work: () => Promise<T>): Promise<T> {
    throw new Error('transaction failed');
  }
}

describe('ChangePasswordUseCase', () => {
  const fixedNow = new Date('2026-07-07T18:00:00.000Z');
  const userId = '11111111-1111-4111-8111-111111111111';
  const sessionId = '33333333-3333-4333-8333-333333333333';
  const otherSessionId = '44444444-4444-4444-8444-444444444444';
  const tokenFamilyId = '22222222-2222-4222-8222-222222222222';
  const otherTokenFamilyId = '66666666-6666-4666-8666-666666666666';
  const currentPassword = 'SecurePass123!';
  const newPassword = 'BrandNewPass1!';

  const actor: AuthenticatedUserActor = {
    actorType: AccessTokenActorType.User,
    userId,
    sessionId,
    sessionVersion: 1,
    tokenFamilyId,
  };

  function createActiveUser(overrides?: Partial<ReturnType<User['toProps']>>): User {
    const base = RegistrationPolicy.createPendingUser({
      id: userId,
      email: Email.create('change@example.com'),
      passwordHash: PasswordHash.create(`argon2id$fake$${currentPassword}`),
      firstName: 'Change',
      lastName: 'User',
      phone: null,
      language: 'en',
      at: fixedNow,
    }).verifyEmail(fixedNow);

    return User.reconstitute({ ...base.toProps(), ...overrides });
  }

  async function seedSessions(
    deviceSessionRepository: InMemoryDeviceSessionRepository,
    tokenFamilyRepository: InMemoryTokenFamilyRepository,
  ) {
    const refreshExpiry = SessionPolicy.calculateRefreshExpiry(fixedNow, 30);
    for (const [familyId, id] of [
      [tokenFamilyId, sessionId],
      [otherTokenFamilyId, otherSessionId],
    ] as const) {
      await tokenFamilyRepository.save(
        TokenFamily.create({
          id: familyId,
          userId,
          compromisedAt: null,
          revokedAt: null,
          createdAt: fixedNow,
        }),
      );
      await deviceSessionRepository.save(
        DeviceSession.create({
          id,
          userId,
          tokenFamilyId: familyId,
          refreshTokenHash: `sha256-refresh-${id}`,
          previousRefreshTokenHash: null,
          deviceName: id === sessionId ? 'Current Device' : 'Other Device',
          deviceType: DeviceType.Web,
          ipAddress: '127.0.0.1',
          userAgent: 'jest',
          sessionVersion: 1,
          permissionsVersion: 1,
          lastUsedAt: fixedNow,
          revokedAt: null,
          revokedReason: null,
          expiresAt: refreshExpiry,
          createdAt: fixedNow,
        }),
      );
    }
  }

  function createUseCase(overrides?: {
    userRepository?: InMemoryUserRepository;
    passwordHistoryRepository?: InMemoryPasswordHistoryRepository;
    passwordResetRepository?: InMemoryPasswordResetRepository;
    deviceSessionRepository?: InMemoryDeviceSessionRepository;
    tokenFamilyRepository?: InMemoryTokenFamilyRepository;
    eventPublisher?: CollectingEventPublisher;
    unitOfWork?: UnitOfWorkPort;
  }) {
    const userRepository = overrides?.userRepository ?? new InMemoryUserRepository();
    const passwordHistoryRepository =
      overrides?.passwordHistoryRepository ?? new InMemoryPasswordHistoryRepository();
    const passwordResetRepository =
      overrides?.passwordResetRepository ?? new InMemoryPasswordResetRepository();
    const deviceSessionRepository =
      overrides?.deviceSessionRepository ?? new InMemoryDeviceSessionRepository();
    const tokenFamilyRepository =
      overrides?.tokenFamilyRepository ?? new InMemoryTokenFamilyRepository();
    const eventPublisher = overrides?.eventPublisher ?? new CollectingEventPublisher();

    const useCase = new ChangePasswordUseCase(
      userRepository,
      passwordHistoryRepository,
      passwordResetRepository,
      deviceSessionRepository,
      tokenFamilyRepository,
      new FakePasswordHasher(),
      overrides?.unitOfWork ?? new ImmediateUnitOfWork(),
      eventPublisher,
      new FixedClock(fixedNow),
      new UuidGenerator(),
      new InMemorySystemConfiguration({
        [SYSTEM_CONFIG_KEYS.passwordHistoryCount]: 5,
      }),
      new FakeTokenService(),
      new FixedAuthTokenTtl(900),
    );

    return {
      useCase,
      userRepository,
      passwordHistoryRepository,
      passwordResetRepository,
      deviceSessionRepository,
      tokenFamilyRepository,
      eventPublisher,
    };
  }

  it('changes password, preserves current session, and revokes other sessions', async () => {
    const {
      useCase,
      userRepository,
      passwordHistoryRepository,
      deviceSessionRepository,
      tokenFamilyRepository,
      eventPublisher,
    } = createUseCase();
    await userRepository.save(createActiveUser());
    await seedSessions(deviceSessionRepository, tokenFamilyRepository);

    const result = await useCase.execute({
      actor,
      currentPassword,
      newPassword,
    });

    expect(result.message).toBe('Password changed successfully.');
    expect(result.sessionVersion).toBe(2);
    expect(result.accessToken).toBe(`jwt.${userId}.${sessionId}`);
    expect(result.accessTokenExpiresAt.getTime()).toBe(fixedNow.getTime() + 900_000);

    const updatedUser = (await userRepository.findById(createActiveUser().userId))!;
    expect(updatedUser.passwordHash.value).toBe(`argon2id$fake$${newPassword}`);
    expect(passwordHistoryRepository.history).toHaveLength(1);
    expect(
      deviceSessionRepository.sessions.find((s) => s.sessionId.value === sessionId)?.isRevoked(),
    ).toBe(false);
    expect(
      deviceSessionRepository.sessions
        .find((s) => s.sessionId.value === otherSessionId)
        ?.isRevoked(),
    ).toBe(true);
    expect(
      deviceSessionRepository.sessions.find((s) => s.sessionId.value === sessionId)?.toProps()
        .sessionVersion,
    ).toBe(2);
    expect(eventPublisher.events.some((event) => event instanceof PasswordChangedEvent)).toBe(true);
    expect(
      eventPublisher.events.filter((event) => event instanceof SessionRevokedEvent),
    ).toHaveLength(1);
  });

  it('rejects incorrect current password', async () => {
    const { useCase, userRepository } = createUseCase();
    await userRepository.save(createActiveUser());

    await expect(
      useCase.execute({ actor, currentPassword: 'WrongPass123!', newPassword }),
    ).rejects.toBeInstanceOf(InvalidCredentialsException);
  });

  it('rejects weak and reused passwords', async () => {
    const { useCase, userRepository } = createUseCase();
    await userRepository.save(createActiveUser());

    await expect(
      useCase.execute({ actor, currentPassword, newPassword: 'short' }),
    ).rejects.toBeInstanceOf(WeakPasswordException);

    await expect(
      useCase.execute({ actor, currentPassword, newPassword: currentPassword }),
    ).rejects.toBeInstanceOf(PasswordReusedException);
  });

  it('rejects ineligible users', async () => {
    const { useCase, userRepository } = createUseCase();
    await userRepository.save(
      createActiveUser({ status: UserStatus.Suspended, emailVerified: true }),
    );

    await expect(useCase.execute({ actor, currentPassword, newPassword })).rejects.toBeInstanceOf(
      AccountSuspendedException,
    );
  });

  it('invalidates active reset tokens', async () => {
    const passwordResetRepository = new InMemoryPasswordResetRepository();
    const deviceSessionRepository = new InMemoryDeviceSessionRepository();
    const tokenFamilyRepository = new InMemoryTokenFamilyRepository();
    const { useCase, userRepository } = createUseCase({
      passwordResetRepository,
      deviceSessionRepository,
      tokenFamilyRepository,
    });
    await userRepository.save(createActiveUser());
    await seedSessions(deviceSessionRepository, tokenFamilyRepository);
    passwordResetRepository.tokens.push({
      id: 'reset-token',
      userId,
      tokenHash: 'sha256-reset',
      expiresAt: new Date(fixedNow.getTime() + 3_600_000),
      consumedAt: null,
      createdAt: fixedNow,
    });

    await useCase.execute({ actor, currentPassword, newPassword });

    expect(passwordResetRepository.tokens.every((token) => token.consumedAt !== null)).toBe(true);
  });

  it('does not publish events when transaction fails', async () => {
    const { useCase, userRepository, eventPublisher } = createUseCase({
      unitOfWork: new FailingUnitOfWork(),
    });
    await userRepository.save(createActiveUser());

    await expect(useCase.execute({ actor, currentPassword, newPassword })).rejects.toThrow(
      'transaction failed',
    );
    expect(eventPublisher.events).toHaveLength(0);
  });

  it('fails safely on concurrent credential modification', async () => {
    const userRepository = new InMemoryUserRepository();
    const deviceSessionRepository = new InMemoryDeviceSessionRepository();
    const tokenFamilyRepository = new InMemoryTokenFamilyRepository();
    const originalUpdate = userRepository.updatePasswordIfCurrentHashMatches.bind(userRepository);
    let updateCount = 0;
    userRepository.updatePasswordIfCurrentHashMatches = async (input) => {
      updateCount += 1;
      if (updateCount === 1) {
        return originalUpdate(input);
      }
      return { status: 'hash_mismatch' };
    };

    const { useCase } = createUseCase({
      userRepository,
      deviceSessionRepository,
      tokenFamilyRepository,
    });
    await userRepository.save(createActiveUser());
    await seedSessions(deviceSessionRepository, tokenFamilyRepository);

    await useCase.execute({ actor, currentPassword, newPassword });
    await expect(
      useCase.execute({ actor, currentPassword, newPassword: 'AnotherPass123!' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsException);
  });

  it('throws when user is missing', async () => {
    const { useCase } = createUseCase();
    await expect(useCase.execute({ actor, currentPassword, newPassword })).rejects.toBeInstanceOf(
      InvalidAccessTokenException,
    );
  });
});
