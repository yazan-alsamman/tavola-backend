import { VerifyEmailUseCase } from '@modules/authentication/application/use-cases/verify-email.use-case';
import { UserStatus } from '@modules/authentication/domain/enums/authentication.enums';
import { RegistrationPolicy } from '@modules/authentication/domain/services/registration-policy';
import { Email } from '@shared/domain/value-objects/email.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import {
  CollectingEventPublisher,
  FakeOpaqueTokenService,
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryEmailVerificationRepository,
  InMemoryUserRepository,
  SequentialIdGenerator,
} from './support/in-memory-registration.dependencies';

describe('VerifyEmailUseCase (integration)', () => {
  const fixedNow = new Date('2026-07-07T16:00:00.000Z');
  const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const tokenId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const eventId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const opaqueToken = 'integration-verification-token';

  it('activates user and prevents replay in a second attempt', async () => {
    const userRepository = new InMemoryUserRepository();
    const emailVerificationRepository = new InMemoryEmailVerificationRepository();
    const eventPublisher = new CollectingEventPublisher();
    const opaque = new FakeOpaqueTokenService();

    await userRepository.save(
      RegistrationPolicy.createPendingUser({
        id: userId,
        email: Email.create('integration@example.com'),
        passwordHash: PasswordHash.create('argon2id$hash'),
        firstName: 'Int',
        lastName: 'Test',
        phone: null,
        language: 'en',
        at: fixedNow,
      }),
    );

    emailVerificationRepository.tokens.push({
      id: tokenId,
      userId,
      tokenHash: opaque.hash(opaqueToken),
      expiresAt: new Date(fixedNow.getTime() + 3_600_000),
      consumedAt: null,
      createdAt: fixedNow,
    });

    const useCase = new VerifyEmailUseCase(
      userRepository,
      emailVerificationRepository,
      opaque,
      new ImmediateUnitOfWork(),
      eventPublisher,
      new FixedClock(fixedNow),
      new SequentialIdGenerator([eventId]),
    );

    const result = await useCase.execute({ token: opaqueToken });
    expect(result.status).toBe(UserStatus.Active);

    await expect(useCase.execute({ token: opaqueToken })).rejects.toMatchObject({
      code: 'AUTH_INVALID_TOKEN',
    });
  });
});
