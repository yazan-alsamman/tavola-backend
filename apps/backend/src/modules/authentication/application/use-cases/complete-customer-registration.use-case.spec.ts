import { CompleteCustomerRegistrationUseCase } from './complete-customer-registration.use-case';
import { PendingRegistrationNotFoundException } from '../../domain/exceptions/pending-registration-not-found.exception';
import { RegistrationNotVerifiedException } from '../../domain/exceptions/registration-not-verified.exception';
import {
  CollectingEventPublisher,
  FakePasswordHasher,
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryPendingCustomerRegistrationRepository,
  InMemorySystemConfiguration,
  InMemoryUserRepository,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('CompleteCustomerRegistrationUseCase', () => {
  const fixedNow = new Date('2026-07-22T12:00:00.000Z');
  const userId = '11111111-1111-4111-8111-111111111111';
  const eventId = '22222222-2222-4222-8222-222222222222';
  const phoneCommand = { countryCode: 'SY', phoneNumber: '0912345678', password: 'SecurePass123!' };

  function createUseCase(overrides?: { userRepository?: InMemoryUserRepository }) {
    const userRepository = overrides?.userRepository ?? new InMemoryUserRepository();
    const pendingRegistrationRepository = new InMemoryPendingCustomerRegistrationRepository();

    const useCase = new CompleteCustomerRegistrationUseCase(
      userRepository,
      pendingRegistrationRepository,
      new FakePasswordHasher(),
      new ImmediateUnitOfWork(),
      new CollectingEventPublisher(),
      new FixedClock(fixedNow),
      new SequentialIdGenerator([userId, eventId]),
      new InMemorySystemConfiguration({ otpMaxIncorrectAttempts: 5 }),
    );

    return { useCase, userRepository, pendingRegistrationRepository };
  }

  async function seedVerifiedPendingRegistration(
    pendingRegistrationRepository: InMemoryPendingCustomerRegistrationRepository,
  ) {
    await pendingRegistrationRepository.upsertActive({
      username: 'jane_doe',
      phone: '+963912345678',
      codeHash: 'hash',
      codeExpiresAt: new Date(fixedNow.getTime() + 5 * 60_000),
      now: fixedNow,
    });
    await pendingRegistrationRepository.markVerified(
      pendingRegistrationRepository.rows[0].id,
      fixedNow,
    );
  }

  it('creates the real Customer User with no email, consumes and deletes the pending registration (replay-safe)', async () => {
    const { useCase, userRepository, pendingRegistrationRepository } = createUseCase();
    await seedVerifiedPendingRegistration(pendingRegistrationRepository);

    const result = await useCase.execute(phoneCommand);

    expect(result.userId).toBe(userId);
    expect(result.username).toBe('jane_doe');
    expect(result.phone).toBe('+963912345678');

    const [createdUser] = userRepository.snapshot();
    expect(createdUser.email).toBeNull();
    expect(createdUser.phone).toBe('+963912345678');
    expect(createdUser.username).toBe('jane_doe');

    // Replay-safe: the pending registration row is gone, so a repeat
    // COMPLETE for the same phone must fail, never succeed twice.
    expect(pendingRegistrationRepository.rows).toHaveLength(0);
    await expect(useCase.execute(phoneCommand)).rejects.toThrow(
      PendingRegistrationNotFoundException,
    );
  });

  it('rejects COMPLETE when no pending registration exists for the phone', async () => {
    const { useCase } = createUseCase();
    await expect(useCase.execute(phoneCommand)).rejects.toThrow(
      PendingRegistrationNotFoundException,
    );
  });

  it('rejects COMPLETE when VERIFY never succeeded for this pending registration', async () => {
    const { useCase, pendingRegistrationRepository } = createUseCase();
    await pendingRegistrationRepository.upsertActive({
      username: 'jane_doe',
      phone: '+963912345678',
      codeHash: 'hash',
      codeExpiresAt: new Date(fixedNow.getTime() + 5 * 60_000),
      now: fixedNow,
    });
    // Deliberately not verified.

    await expect(useCase.execute(phoneCommand)).rejects.toThrow(RegistrationNotVerifiedException);
  });

  it('never sets the password/creates the User during VERIFY - only COMPLETE does (regression guard on ordering)', async () => {
    const { useCase, userRepository, pendingRegistrationRepository } = createUseCase();
    await pendingRegistrationRepository.upsertActive({
      username: 'jane_doe',
      phone: '+963912345678',
      codeHash: 'hash',
      codeExpiresAt: new Date(fixedNow.getTime() + 5 * 60_000),
      now: fixedNow,
    });
    expect(userRepository.snapshot()).toHaveLength(0);

    await expect(useCase.execute(phoneCommand)).rejects.toThrow(RegistrationNotVerifiedException);
    expect(userRepository.snapshot()).toHaveLength(0);
  });
});
