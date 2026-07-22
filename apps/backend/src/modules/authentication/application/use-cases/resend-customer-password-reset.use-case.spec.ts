import { ResendCustomerPasswordResetUseCase } from './resend-customer-password-reset.use-case';
import { ResendCustomerPasswordResetCommand } from '../dto/customer-password-reset.command';
import { CustomerRegistrationPolicy } from '../../domain/services/customer-registration.policy';
import { PhoneNumber } from '@shared/domain/value-objects/phone-number.vo';
import { Username } from '@shared/domain/value-objects/username.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { CUSTOMER_OTP_SENT_MESSAGE } from '../dto/customer-otp.result';
import {
  CollectingEventPublisher,
  FakeOtpService,
  FixedClock,
  InMemoryCustomerPasswordResetRepository,
  InMemorySystemConfiguration,
  InMemoryUserRepository,
  RecordingVerificationMessagingPort,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('ResendCustomerPasswordResetUseCase', () => {
  const fixedNow = new Date('2026-07-22T12:00:00.000Z');
  const eventId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';

  const command: ResendCustomerPasswordResetCommand = {
    countryCode: 'SY',
    phoneNumber: '0912345678',
  };

  async function createUseCase(now: Date, systemConfig?: Record<string, number>) {
    const userRepository = new InMemoryUserRepository();
    const user = CustomerRegistrationPolicy.createActiveCustomer({
      id: userId,
      username: Username.create('jane_doe'),
      phone: PhoneNumber.create('SY', '0912345678'),
      passwordHash: PasswordHash.create('argon2id$fake$hash'),
      at: fixedNow,
    });
    await userRepository.save(user);

    const customerPasswordResetRepository = new InMemoryCustomerPasswordResetRepository();
    const otpService = new FakeOtpService();
    const verificationMessaging = new RecordingVerificationMessagingPort();
    const eventPublisher = new CollectingEventPublisher();

    const useCase = new ResendCustomerPasswordResetUseCase(
      userRepository,
      customerPasswordResetRepository,
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

    return { useCase, userRepository, customerPasswordResetRepository, verificationMessaging };
  }

  it('returns the generic sent message for an unknown phone, without sending anything (enumeration resistance)', async () => {
    const { useCase, verificationMessaging } = await createUseCase(fixedNow);
    const result = await useCase.execute({ countryCode: 'AE', phoneNumber: '0501234567' });

    expect(result.message).toBe(CUSTOMER_OTP_SENT_MESSAGE);
    expect(verificationMessaging.calls).toHaveLength(0);
  });

  it('returns the generic sent message when there is no active challenge, without sending anything', async () => {
    const { useCase, verificationMessaging } = await createUseCase(fixedNow);
    const result = await useCase.execute(command);

    expect(result.message).toBe(CUSTOMER_OTP_SENT_MESSAGE);
    expect(verificationMessaging.calls).toHaveLength(0);
  });

  it('reissues a new OTP, invalidating the previous one, once the cooldown has elapsed', async () => {
    const { useCase, customerPasswordResetRepository, verificationMessaging } =
      await createUseCase(fixedNow);
    await customerPasswordResetRepository.save({
      id: 'reset-1',
      userId,
      codeHash: 'original-hash',
      codeExpiresAt: new Date(fixedNow.getTime() + 5 * 60_000),
      incorrectAttemptCount: 0,
      verifiedAt: null,
      consumedAt: null,
      createdAt: new Date(fixedNow.getTime() - 61_000),
      updatedAt: new Date(fixedNow.getTime() - 61_000),
    });

    const result = await useCase.execute(command);

    expect(result.message).toBe(CUSTOMER_OTP_SENT_MESSAGE);
    expect(verificationMessaging.calls).toHaveLength(1);
    const activeRows = customerPasswordResetRepository.rows.filter(
      (row) => row.consumedAt === null,
    );
    expect(activeRows).toHaveLength(1);
    expect(activeRows[0].codeHash).not.toBe('original-hash');
  });

  it('returns the generic sent message and does NOT send when still within the cooldown window (silent, not a distinct error)', async () => {
    const { useCase, customerPasswordResetRepository, verificationMessaging } =
      await createUseCase(fixedNow);
    await customerPasswordResetRepository.save({
      id: 'reset-1',
      userId,
      codeHash: 'original-hash',
      codeExpiresAt: new Date(fixedNow.getTime() + 5 * 60_000),
      incorrectAttemptCount: 0,
      verifiedAt: null,
      consumedAt: null,
      createdAt: new Date(fixedNow.getTime() - 5_000),
      updatedAt: new Date(fixedNow.getTime() - 5_000),
    });

    const result = await useCase.execute(command);

    expect(result.message).toBe(CUSTOMER_OTP_SENT_MESSAGE);
    expect(verificationMessaging.calls).toHaveLength(0);
    expect(customerPasswordResetRepository.rows[0].codeHash).toBe('original-hash');
  });
});
