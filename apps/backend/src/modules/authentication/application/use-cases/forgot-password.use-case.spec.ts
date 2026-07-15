import { ForgotPasswordUseCase } from './forgot-password.use-case';
import { RegistrationPolicy } from '../../domain/services/registration-policy';
import { Email } from '@shared/domain/value-objects/email.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { UserStatus } from '../../domain/enums/authentication.enums';
import { PasswordResetRequestedEvent } from '../../domain/events/authentication.events';
import { FORGOT_PASSWORD_GENERIC_MESSAGE } from '../dto/forgot-password.result';
import { SYSTEM_CONFIG_KEYS } from '@shared/application/ports/system-configuration.port';
import { User } from '../../domain/entities/user.entity';
import {
  CollectingEventPublisher,
  FakeOpaqueTokenService,
  FakePasswordHasher,
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryPasswordResetRepository,
  InMemorySystemConfiguration,
  InMemoryUserRepository,
  UuidGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { UnitOfWorkPort } from '@shared/application/ports/unit-of-work.port';
import {
  TIMING_SAFE_DUMMY_PASSWORD,
  TIMING_SAFE_DUMMY_PASSWORD_HASH,
} from '../../domain/services/timing-safe-dummy';

class FailingUnitOfWork implements UnitOfWorkPort {
  async execute<T>(_work: () => Promise<T>): Promise<T> {
    throw new Error('transaction failed');
  }
}

describe('ForgotPasswordUseCase', () => {
  const fixedNow = new Date('2026-07-07T12:00:00.000Z');
  const userId = '11111111-1111-4111-8111-111111111111';

  function createActiveUser(overrides?: Partial<ReturnType<User['toProps']>>): User {
    const base = RegistrationPolicy.createPendingUser({
      id: userId,
      email: Email.create('reset@example.com'),
      passwordHash: PasswordHash.create('argon2id$fake$SecurePass123!'),
      firstName: 'Reset',
      lastName: 'User',
      phone: null,
      language: 'en',
      at: fixedNow,
    }).verifyEmail(fixedNow);

    return User.reconstitute({ ...base.toProps(), ...overrides });
  }

  function createUseCase(overrides?: {
    userRepository?: InMemoryUserRepository;
    passwordResetRepository?: InMemoryPasswordResetRepository;
    eventPublisher?: CollectingEventPublisher;
    unitOfWork?: UnitOfWorkPort;
    systemConfiguration?: InMemorySystemConfiguration;
  }) {
    const userRepository = overrides?.userRepository ?? new InMemoryUserRepository();
    const passwordResetRepository =
      overrides?.passwordResetRepository ?? new InMemoryPasswordResetRepository();
    const eventPublisher = overrides?.eventPublisher ?? new CollectingEventPublisher();
    const opaqueTokenService = new FakeOpaqueTokenService();
    const passwordHasher = new FakePasswordHasher();

    const useCase = new ForgotPasswordUseCase(
      userRepository,
      passwordResetRepository,
      opaqueTokenService,
      passwordHasher,
      overrides?.unitOfWork ?? new ImmediateUnitOfWork(),
      eventPublisher,
      new FixedClock(fixedNow),
      new UuidGenerator(),
      overrides?.systemConfiguration ??
        new InMemorySystemConfiguration({
          [SYSTEM_CONFIG_KEYS.passwordResetTokenTtlHours]: 2,
        }),
    );

    return {
      useCase,
      userRepository,
      passwordResetRepository,
      eventPublisher,
      opaqueTokenService,
      passwordHasher,
    };
  }

  it('creates a hashed reset token and publishes event for eligible users', async () => {
    const { useCase, userRepository, passwordResetRepository, eventPublisher } = createUseCase();
    await userRepository.save(createActiveUser());

    const result = await useCase.execute({ email: 'reset@example.com' });

    expect(result.message).toBe(FORGOT_PASSWORD_GENERIC_MESSAGE);
    expect(passwordResetRepository.tokens).toHaveLength(1);
    expect(passwordResetRepository.tokens[0].tokenHash).toBe('sha256-opaque-token-1');
    expect(passwordResetRepository.tokens[0].tokenHash).not.toBe('opaque-token-1');
    expect(passwordResetRepository.tokens[0].expiresAt).toEqual(
      new Date(fixedNow.getTime() + 2 * 3_600_000),
    );
    expect(eventPublisher.events).toHaveLength(1);
    expect(eventPublisher.events[0]).toBeInstanceOf(PasswordResetRequestedEvent);
  });

  it('returns the same generic response for unknown emails', async () => {
    const { useCase, passwordResetRepository, eventPublisher, passwordHasher } = createUseCase();
    const verifySpy = jest.spyOn(passwordHasher, 'verify');

    const result = await useCase.execute({ email: 'missing@example.com' });

    expect(result.message).toBe(FORGOT_PASSWORD_GENERIC_MESSAGE);
    expect(passwordResetRepository.tokens).toHaveLength(0);
    expect(eventPublisher.events).toHaveLength(0);
    // Timing-equalization: an unknown email still pays the Argon2 verify
    // cost, comparing the fixed dummy credential (not skipped, not
    // compared against anything derived from the request), so response
    // time does not leak account existence.
    expect(verifySpy).toHaveBeenCalledTimes(1);
    const [passwordArg, hashArg] = verifySpy.mock.calls[0];
    expect(passwordArg.value).toBe(TIMING_SAFE_DUMMY_PASSWORD);
    expect(hashArg.value).toBe(TIMING_SAFE_DUMMY_PASSWORD_HASH);
  });

  it('returns the same generic response for ineligible users', async () => {
    const { useCase, userRepository, passwordResetRepository, eventPublisher, passwordHasher } =
      createUseCase();
    const verifySpy = jest.spyOn(passwordHasher, 'verify');
    await userRepository.save(
      createActiveUser({ status: UserStatus.Suspended, emailVerified: true }),
    );

    const result = await useCase.execute({ email: 'reset@example.com' });

    expect(result.message).toBe(FORGOT_PASSWORD_GENERIC_MESSAGE);
    expect(passwordResetRepository.tokens).toHaveLength(0);
    expect(eventPublisher.events).toHaveLength(0);
    // Same timing-equalization property as the unknown-email branch above -
    // an ineligible (e.g. suspended) user must not respond measurably
    // faster than the eligible-user path either.
    expect(verifySpy).toHaveBeenCalledTimes(1);
  });

  it('invalidates previous active reset tokens before creating a new one', async () => {
    const passwordResetRepository = new InMemoryPasswordResetRepository();
    const { useCase, userRepository } = createUseCase({ passwordResetRepository });
    await userRepository.save(createActiveUser());
    passwordResetRepository.tokens.push({
      id: 'old-token-id',
      userId,
      tokenHash: 'sha256-old',
      expiresAt: new Date(fixedNow.getTime() + 3_600_000),
      consumedAt: null,
      createdAt: fixedNow,
    });

    await useCase.execute({ email: 'reset@example.com' });

    const activeTokens = passwordResetRepository.tokens.filter(
      (token) => token.consumedAt === null,
    );
    expect(activeTokens).toHaveLength(1);
    expect(activeTokens[0].tokenHash).toBe('sha256-opaque-token-1');
  });

  it('does not publish events when persistence fails', async () => {
    const { useCase, userRepository, eventPublisher } = createUseCase({
      unitOfWork: new FailingUnitOfWork(),
    });
    await userRepository.save(createActiveUser());

    await expect(useCase.execute({ email: 'reset@example.com' })).rejects.toThrow(
      'transaction failed',
    );
    expect(eventPublisher.events).toHaveLength(0);
  });
});
