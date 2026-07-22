import { VerifyCustomerRegistrationUseCase } from './verify-customer-registration.use-case';
import { PendingRegistrationNotFoundException } from '../../domain/exceptions/pending-registration-not-found.exception';
import { InvalidOtpException } from '../../domain/exceptions/invalid-otp.exception';
import { ExpiredOtpException } from '../../domain/exceptions/expired-otp.exception';
import { OtpAttemptsExhaustedException } from '../../domain/exceptions/otp-attempts-exhausted.exception';
import {
  CollectingEventPublisher,
  FakeOtpService,
  FixedClock,
  InMemoryPendingCustomerRegistrationRepository,
  InMemorySystemConfiguration,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('VerifyCustomerRegistrationUseCase', () => {
  const fixedNow = new Date('2026-07-22T12:00:00.000Z');
  const phoneCommand = { countryCode: 'SY', phoneNumber: '0912345678' };

  function createUseCase(now: Date = fixedNow) {
    const pendingRegistrationRepository = new InMemoryPendingCustomerRegistrationRepository();
    const otpService = new FakeOtpService();
    const useCase = new VerifyCustomerRegistrationUseCase(
      pendingRegistrationRepository,
      otpService,
      new FixedClock(now),
      new SequentialIdGenerator(['11111111-1111-4111-8111-111111111111']),
      new CollectingEventPublisher(),
      new InMemorySystemConfiguration({ otpMaxIncorrectAttempts: 5 }),
    );
    return { useCase, pendingRegistrationRepository, otpService };
  }

  async function seedPendingRegistration(
    pendingRegistrationRepository: InMemoryPendingCustomerRegistrationRepository,
    otpService: FakeOtpService,
    overrides?: { codeExpiresAt?: Date; incorrectAttemptCount?: number },
  ) {
    const code = otpService.generate();
    await pendingRegistrationRepository.upsertActive({
      username: 'jane_doe',
      phone: '+963912345678',
      codeHash: otpService.hash(code),
      codeExpiresAt: overrides?.codeExpiresAt ?? new Date(fixedNow.getTime() + 5 * 60_000),
      now: fixedNow,
    });
    if (overrides?.incorrectAttemptCount) {
      for (let i = 0; i < overrides.incorrectAttemptCount; i += 1) {
        await pendingRegistrationRepository.incrementAttemptCount(
          pendingRegistrationRepository.rows[0].id,
        );
      }
    }
    return code;
  }

  it('marks the pending registration verified on a correct code, without creating a User or session', async () => {
    const { useCase, pendingRegistrationRepository, otpService } = createUseCase();
    const code = await seedPendingRegistration(pendingRegistrationRepository, otpService);

    const result = await useCase.execute({ ...phoneCommand, code });

    expect(result.message).toBeDefined();
    expect(pendingRegistrationRepository.rows[0].verifiedAt).not.toBeNull();
    expect(pendingRegistrationRepository.rows[0].consumedAt).toBeNull();
  });

  it('rejects when no pending registration exists for the phone', async () => {
    const { useCase } = createUseCase();
    await expect(useCase.execute({ ...phoneCommand, code: '123456' })).rejects.toThrow(
      PendingRegistrationNotFoundException,
    );
  });

  it('increments the attempt counter and rejects on a wrong code', async () => {
    const { useCase, pendingRegistrationRepository, otpService } = createUseCase();
    await seedPendingRegistration(pendingRegistrationRepository, otpService);

    await expect(useCase.execute({ ...phoneCommand, code: '000000' })).rejects.toThrow(
      InvalidOtpException,
    );
    expect(pendingRegistrationRepository.rows[0].incorrectAttemptCount).toBe(1);
  });

  it('rejects with OtpAttemptsExhaustedException after the max incorrect attempts, without a silent auto-reissue', async () => {
    const { useCase, pendingRegistrationRepository, otpService } = createUseCase();
    await seedPendingRegistration(pendingRegistrationRepository, otpService, {
      incorrectAttemptCount: 5,
    });

    await expect(useCase.execute({ ...phoneCommand, code: '000000' })).rejects.toThrow(
      OtpAttemptsExhaustedException,
    );
  });

  it('rejects an expired code', async () => {
    const { useCase, pendingRegistrationRepository, otpService } = createUseCase();
    const code = await seedPendingRegistration(pendingRegistrationRepository, otpService, {
      codeExpiresAt: new Date(fixedNow.getTime() - 1_000),
    });

    await expect(useCase.execute({ ...phoneCommand, code })).rejects.toThrow(ExpiredOtpException);
  });
});
