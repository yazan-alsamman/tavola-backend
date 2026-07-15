import { VerifyEmailUseCase } from './verify-email.use-case';
import { InvalidVerificationTokenException } from '../exceptions/invalid-verification-token.exception';
import { ExpiredVerificationTokenException } from '../exceptions/expired-verification-token.exception';
import { EmailAlreadyVerifiedException } from '../exceptions/email-already-verified.exception';
import { UserNotFoundException } from '../exceptions/user-not-found.exception';
import { RegistrationPolicy } from '../../domain/services/registration-policy';
import { Email } from '@shared/domain/value-objects/email.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { UserStatus } from '../../domain/enums/authentication.enums';
import { EmailVerifiedEvent } from '../../domain/events/authentication.events';
import {
  CollectingEventPublisher,
  FakeOpaqueTokenService,
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryEmailVerificationRepository,
  InMemoryUserRepository,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('VerifyEmailUseCase', () => {
  const fixedNow = new Date('2026-07-07T12:00:00.000Z');
  const userId = '11111111-1111-4111-8111-111111111111';
  const tokenId = '22222222-2222-4222-8222-222222222222';
  const eventId = '33333333-3333-4333-8333-333333333333';
  const opaqueToken = 'valid-verification-token';

  function createPendingUser() {
    return RegistrationPolicy.createPendingUser({
      id: userId,
      email: Email.create('verify@example.com'),
      passwordHash: PasswordHash.create('argon2id$hash'),
      firstName: 'Verify',
      lastName: 'Me',
      phone: null,
      language: 'en',
      at: fixedNow,
    });
  }

  function seedValidToken(
    emailVerificationRepository: InMemoryEmailVerificationRepository,
    expiresAt: Date = new Date(fixedNow.getTime() + 3_600_000),
  ) {
    const opaque = new FakeOpaqueTokenService();
    emailVerificationRepository.tokens.push({
      id: tokenId,
      userId,
      tokenHash: opaque.hash(opaqueToken),
      expiresAt,
      consumedAt: null,
      createdAt: fixedNow,
    });
  }

  function createUseCase(overrides?: {
    userRepository?: InMemoryUserRepository;
    emailVerificationRepository?: InMemoryEmailVerificationRepository;
    eventPublisher?: CollectingEventPublisher;
    unitOfWork?: ImmediateUnitOfWork;
  }) {
    const userRepository = overrides?.userRepository ?? new InMemoryUserRepository();
    const emailVerificationRepository =
      overrides?.emailVerificationRepository ?? new InMemoryEmailVerificationRepository();
    const eventPublisher = overrides?.eventPublisher ?? new CollectingEventPublisher();

    const useCase = new VerifyEmailUseCase(
      userRepository,
      emailVerificationRepository,
      new FakeOpaqueTokenService(),
      overrides?.unitOfWork ?? new ImmediateUnitOfWork(),
      eventPublisher,
      new FixedClock(fixedNow),
      new SequentialIdGenerator([eventId]),
    );

    return { useCase, userRepository, emailVerificationRepository, eventPublisher };
  }

  it('verifies a pending user and consumes the token', async () => {
    const { useCase, userRepository, emailVerificationRepository, eventPublisher } =
      createUseCase();

    await userRepository.save(createPendingUser());
    seedValidToken(emailVerificationRepository);

    const result = await useCase.execute({ token: opaqueToken });

    expect(result).toEqual({
      userId,
      email: 'verify@example.com',
      status: UserStatus.Active,
    });

    const savedUser = (await userRepository.findById(
      (await import('@shared/domain/value-objects/identifiers.vo')).UserId.create(userId),
    ))!;
    expect(savedUser.emailVerified).toBe(true);
    expect(savedUser.status).toBe(UserStatus.Active);
    expect(emailVerificationRepository.tokens[0].consumedAt).toEqual(fixedNow);
    expect(eventPublisher.events[0]).toBeInstanceOf(EmailVerifiedEvent);
  });

  it('rejects invalid tokens', async () => {
    const { useCase } = createUseCase();
    await expect(useCase.execute({ token: 'missing-token' })).rejects.toBeInstanceOf(
      InvalidVerificationTokenException,
    );
  });

  it('rejects expired tokens', async () => {
    const { useCase, userRepository, emailVerificationRepository } = createUseCase();
    await userRepository.save(createPendingUser());
    seedValidToken(emailVerificationRepository, new Date(fixedNow.getTime() - 1_000));

    await expect(useCase.execute({ token: opaqueToken })).rejects.toBeInstanceOf(
      ExpiredVerificationTokenException,
    );
  });

  it('rejects consumed tokens (replay)', async () => {
    const { useCase, userRepository, emailVerificationRepository } = createUseCase();
    await userRepository.save(createPendingUser());
    seedValidToken(emailVerificationRepository);
    emailVerificationRepository.tokens[0].consumedAt = new Date(fixedNow.getTime() - 60_000);

    await expect(useCase.execute({ token: opaqueToken })).rejects.toBeInstanceOf(
      InvalidVerificationTokenException,
    );
  });

  it('rejects already verified users', async () => {
    const { useCase, userRepository, emailVerificationRepository } = createUseCase();
    const user = createPendingUser().verifyEmail(fixedNow);
    await userRepository.save(user);
    seedValidToken(emailVerificationRepository);

    await expect(useCase.execute({ token: opaqueToken })).rejects.toBeInstanceOf(
      EmailAlreadyVerifiedException,
    );
  });

  it('rejects when user record is missing', async () => {
    const { useCase, emailVerificationRepository } = createUseCase();
    seedValidToken(emailVerificationRepository);

    await expect(useCase.execute({ token: opaqueToken })).rejects.toBeInstanceOf(
      UserNotFoundException,
    );
  });

  it('rejects concurrent verification when token was already consumed in transaction', async () => {
    const userRepository = new InMemoryUserRepository();
    const emailVerificationRepository = new InMemoryEmailVerificationRepository();
    await userRepository.save(createPendingUser());
    seedValidToken(emailVerificationRepository);

    const failingUnitOfWork = {
      execute: async <T>(work: () => Promise<T>) => {
        emailVerificationRepository.tokens[0].consumedAt = fixedNow;
        return work();
      },
    };

    const { useCase } = createUseCase({
      userRepository,
      emailVerificationRepository,
      unitOfWork: failingUnitOfWork as never,
    });

    await expect(useCase.execute({ token: opaqueToken })).rejects.toBeInstanceOf(
      InvalidVerificationTokenException,
    );
  });
});

describe('EmailVerificationPolicy', () => {
  it('resolves token states', async () => {
    const { EmailVerificationPolicy } =
      await import('../../domain/services/email-verification.policy');
    const now = new Date('2026-07-07T12:00:00.000Z');
    const base = {
      id: '1',
      userId: '2',
      tokenHash: 'abc',
      createdAt: now,
      consumedAt: null,
      expiresAt: new Date(now.getTime() + 3_600_000),
    };

    expect(EmailVerificationPolicy.resolveTokenState(base, now)).toBe('valid');
    expect(
      EmailVerificationPolicy.resolveTokenState(
        { ...base, expiresAt: new Date(now.getTime() - 1) },
        now,
      ),
    ).toBe('expired');
    expect(EmailVerificationPolicy.resolveTokenState({ ...base, consumedAt: now }, now)).toBe(
      'consumed',
    );
  });
});
