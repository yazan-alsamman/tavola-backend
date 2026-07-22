import { StartCustomerRegistrationUseCase } from './start-customer-registration.use-case';
import { StartCustomerRegistrationCommand } from '../dto/start-customer-registration.command';
import { UsernameAlreadyExistsException } from '../../domain/exceptions/username-already-exists.exception';
import { PhoneAlreadyExistsException } from '../../domain/exceptions/phone-already-exists.exception';
import { VerificationMessagingFailedException } from '../../domain/exceptions/verification-messaging-failed.exception';
import { CustomerRegistrationPolicy } from '../../domain/services/customer-registration.policy';
import { PhoneNumber } from '@shared/domain/value-objects/phone-number.vo';
import { Username } from '@shared/domain/value-objects/username.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import {
  CollectingEventPublisher,
  FakeOtpService,
  FixedClock,
  InMemoryPendingCustomerRegistrationRepository,
  InMemorySystemConfiguration,
  InMemoryUserRepository,
  RecordingVerificationMessagingPort,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('StartCustomerRegistrationUseCase', () => {
  const fixedNow = new Date('2026-07-22T12:00:00.000Z');
  const eventId = '11111111-1111-4111-8111-111111111111';

  const validCommand: StartCustomerRegistrationCommand = {
    username: 'jane_doe',
    countryCode: 'SY',
    phoneNumber: '0912345678',
  };

  function createUseCase(overrides?: {
    userRepository?: InMemoryUserRepository;
    pendingRegistrationRepository?: InMemoryPendingCustomerRegistrationRepository;
    verificationMessaging?: RecordingVerificationMessagingPort;
  }) {
    const userRepository = overrides?.userRepository ?? new InMemoryUserRepository();
    const pendingRegistrationRepository =
      overrides?.pendingRegistrationRepository ??
      new InMemoryPendingCustomerRegistrationRepository();
    const otpService = new FakeOtpService();
    const verificationMessaging =
      overrides?.verificationMessaging ?? new RecordingVerificationMessagingPort();
    const eventPublisher = new CollectingEventPublisher();

    const useCase = new StartCustomerRegistrationUseCase(
      userRepository,
      pendingRegistrationRepository,
      otpService,
      verificationMessaging,
      new FixedClock(fixedNow),
      new SequentialIdGenerator([eventId, eventId, eventId]),
      eventPublisher,
      new InMemorySystemConfiguration({ otpExpiryMinutes: 5 }),
    );

    return {
      useCase,
      userRepository,
      pendingRegistrationRepository,
      verificationMessaging,
      eventPublisher,
    };
  }

  it('creates a pending registration and sends the OTP via VerificationMessagingPort', async () => {
    const { useCase, pendingRegistrationRepository, verificationMessaging, eventPublisher } =
      createUseCase();

    const result = await useCase.execute(validCommand);

    expect(result.message).toBeDefined();
    expect(pendingRegistrationRepository.rows).toHaveLength(1);
    expect(pendingRegistrationRepository.rows[0].phone).toBe('+963912345678');
    expect(pendingRegistrationRepository.rows[0].username).toBe('jane_doe');
    expect(pendingRegistrationRepository.rows[0].consumedAt).toBeNull();
    expect(verificationMessaging.calls).toHaveLength(1);
    expect(verificationMessaging.calls[0].phone).toBe('+963912345678');
    expect(eventPublisher.events).toHaveLength(1);
    expect(eventPublisher.events[0].eventName).toBe('CustomerPhoneVerificationRequested');
  });

  it('never returns or logs the OTP itself', async () => {
    const { useCase } = createUseCase();
    const result = await useCase.execute(validCommand);
    expect(JSON.stringify(result)).not.toMatch(/\d{6}/);
  });

  it('rejects when the username already belongs to a real User', async () => {
    const userRepository = new InMemoryUserRepository();
    const existing = CustomerRegistrationPolicy.createActiveCustomer({
      id: '22222222-2222-4222-8222-222222222222',
      username: Username.create('jane_doe'),
      phone: PhoneNumber.create('SY', '0900000000'),
      passwordHash: PasswordHash.create('argon2id$fake$hash'),
      at: fixedNow,
    });
    await userRepository.save(existing);

    const { useCase } = createUseCase({ userRepository });

    await expect(useCase.execute(validCommand)).rejects.toThrow(UsernameAlreadyExistsException);
  });

  it('rejects when the phone already belongs to a real User', async () => {
    const userRepository = new InMemoryUserRepository();
    const existing = CustomerRegistrationPolicy.createActiveCustomer({
      id: '22222222-2222-4222-8222-222222222222',
      username: Username.create('someone_else'),
      phone: PhoneNumber.create('SY', '0912345678'),
      passwordHash: PasswordHash.create('argon2id$fake$hash'),
      at: fixedNow,
    });
    await userRepository.save(existing);

    const { useCase } = createUseCase({ userRepository });

    await expect(useCase.execute(validCommand)).rejects.toThrow(PhoneAlreadyExistsException);
  });

  it('repeated START for the same phone restarts the same pending registration (ADR-022 Decision #18) rather than creating a second one', async () => {
    const pendingRegistrationRepository = new InMemoryPendingCustomerRegistrationRepository();
    const { useCase } = createUseCase({ pendingRegistrationRepository });

    await useCase.execute(validCommand);
    const firstHash = pendingRegistrationRepository.rows[0].codeHash;

    await useCase.execute({ ...validCommand, username: 'jane_doe_2' });

    expect(pendingRegistrationRepository.rows).toHaveLength(1);
    expect(pendingRegistrationRepository.rows[0].username).toBe('jane_doe_2');
    expect(pendingRegistrationRepository.rows[0].codeHash).not.toBe(firstHash);
    expect(pendingRegistrationRepository.rows[0].incorrectAttemptCount).toBe(0);
  });

  it('does not create the pending registration if the provider send fails', async () => {
    const verificationMessaging = new RecordingVerificationMessagingPort();
    verificationMessaging.nextResult = { status: 'failed' };
    const { useCase } = createUseCase({ verificationMessaging });

    await expect(useCase.execute(validCommand)).rejects.toThrow(
      VerificationMessagingFailedException,
    );
  });

  it('rejects an invalid country/phone combination', async () => {
    const { useCase } = createUseCase();
    await expect(
      useCase.execute({ ...validCommand, countryCode: 'SY', phoneNumber: 'not-a-number' }),
    ).rejects.toThrow();
  });
});
