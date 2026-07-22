import { ResendCustomerRegistrationUseCase } from './resend-customer-registration.use-case';
import { ResendCustomerRegistrationCommand } from '../dto/resend-customer-registration.command';
import { PendingRegistrationNotFoundException } from '../../domain/exceptions/pending-registration-not-found.exception';
import { RateLimitExceededException } from '../../domain/exceptions/rate-limit-exceeded.exception';
import {
  CollectingEventPublisher,
  FakeOtpService,
  FixedClock,
  InMemoryPendingCustomerRegistrationRepository,
  InMemorySystemConfiguration,
  RecordingVerificationMessagingPort,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('ResendCustomerRegistrationUseCase', () => {
  const fixedNow = new Date('2026-07-22T12:00:00.000Z');
  const eventId = '11111111-1111-4111-8111-111111111111';

  const command: ResendCustomerRegistrationCommand = {
    countryCode: 'SY',
    phoneNumber: '0912345678',
  };

  function createUseCase(now: Date, systemConfig?: Record<string, number>) {
    const pendingRegistrationRepository = new InMemoryPendingCustomerRegistrationRepository();
    const otpService = new FakeOtpService();
    const verificationMessaging = new RecordingVerificationMessagingPort();
    const eventPublisher = new CollectingEventPublisher();

    const useCase = new ResendCustomerRegistrationUseCase(
      pendingRegistrationRepository,
      otpService,
      verificationMessaging,
      new FixedClock(now),
      new SequentialIdGenerator([eventId, eventId, eventId]),
      eventPublisher,
      new InMemorySystemConfiguration({
        otpExpiryMinutes: 5,
        otpResendCooldownSeconds: 60,
        ...systemConfig,
      }),
    );

    return { useCase, pendingRegistrationRepository, verificationMessaging, eventPublisher };
  }

  it('rejects when there is no pending registration for this phone', async () => {
    const { useCase } = createUseCase(fixedNow);
    await expect(useCase.execute(command)).rejects.toThrow(PendingRegistrationNotFoundException);
  });

  it('reissues a new OTP, invalidating the previous one, once the cooldown has elapsed', async () => {
    const { useCase, pendingRegistrationRepository, verificationMessaging } =
      createUseCase(fixedNow);
    await pendingRegistrationRepository.upsertActive({
      username: 'jane_doe',
      phone: '+963912345678',
      codeHash: 'original-hash',
      codeExpiresAt: new Date(fixedNow.getTime() + 5 * 60_000),
      now: new Date(fixedNow.getTime() - 61_000),
    });

    const result = await useCase.execute(command);

    expect(result.message).toBeDefined();
    expect(pendingRegistrationRepository.rows).toHaveLength(1);
    expect(pendingRegistrationRepository.rows[0].codeHash).not.toBe('original-hash');
    expect(pendingRegistrationRepository.rows[0].incorrectAttemptCount).toBe(0);
    expect(verificationMessaging.calls).toHaveLength(1);
  });

  it('rejects a resend attempted before the cooldown window has elapsed (ADR-022 Decision #6)', async () => {
    const { useCase, pendingRegistrationRepository, verificationMessaging } =
      createUseCase(fixedNow);
    await pendingRegistrationRepository.upsertActive({
      username: 'jane_doe',
      phone: '+963912345678',
      codeHash: 'original-hash',
      codeExpiresAt: new Date(fixedNow.getTime() + 5 * 60_000),
      now: new Date(fixedNow.getTime() - 5_000),
    });

    await expect(useCase.execute(command)).rejects.toThrow(RateLimitExceededException);
    expect(pendingRegistrationRepository.rows[0].codeHash).toBe('original-hash');
    expect(verificationMessaging.calls).toHaveLength(0);
  });

  it('allows a resend exactly at the cooldown boundary', async () => {
    const { useCase, pendingRegistrationRepository } = createUseCase(fixedNow);
    await pendingRegistrationRepository.upsertActive({
      username: 'jane_doe',
      phone: '+963912345678',
      codeHash: 'original-hash',
      codeExpiresAt: new Date(fixedNow.getTime() + 5 * 60_000),
      now: new Date(fixedNow.getTime() - 60_000),
    });

    await expect(useCase.execute(command)).resolves.toBeDefined();
  });
});
