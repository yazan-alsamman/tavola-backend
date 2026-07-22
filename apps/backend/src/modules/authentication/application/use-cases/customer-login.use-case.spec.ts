import { CustomerLoginUseCase } from './customer-login.use-case';
import { CustomerRegistrationPolicy } from '../../domain/services/customer-registration.policy';
import { PhoneNumber } from '@shared/domain/value-objects/phone-number.vo';
import { Username } from '@shared/domain/value-objects/username.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { AccessTokenActorType } from '../../domain/services/access-token-claims';
import { InvalidCredentialsException } from '../exceptions/login.exceptions';
import { User } from '../../domain/entities/user.entity';
import {
  CollectingAuditLogWriter,
  CollectingEventPublisher,
  FakeOpaqueTokenService,
  FakePasswordHasher,
  FakeTokenService,
  FixedAuthTokenTtl,
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryDeviceSessionRepository,
  InMemoryLoginAttemptRepository,
  InMemorySystemConfiguration,
  InMemoryTokenFamilyRepository,
  InMemoryUserRepository,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('CustomerLoginUseCase', () => {
  const fixedNow = new Date('2026-07-22T12:00:00.000Z');
  const userId = '11111111-1111-4111-8111-111111111111';
  const tokenFamilyId = '22222222-2222-4222-8222-222222222222';
  const sessionId = '33333333-3333-4333-8333-333333333333';
  const loginAttemptId = '44444444-4444-4444-8444-444444444444';
  const eventId = '55555555-5555-4555-8555-555555555555';
  const password = 'SecurePass123!';

  function createCustomer(): User {
    return CustomerRegistrationPolicy.createActiveCustomer({
      id: userId,
      username: Username.create('jane_doe'),
      phone: PhoneNumber.create('SY', '0912345678'),
      passwordHash: PasswordHash.create(`argon2id$fake$${password}`),
      at: fixedNow,
    });
  }

  function createUseCase(overrides?: { userRepository?: InMemoryUserRepository }) {
    const userRepository = overrides?.userRepository ?? new InMemoryUserRepository();
    const deviceSessionRepository = new InMemoryDeviceSessionRepository();
    const tokenFamilyRepository = new InMemoryTokenFamilyRepository();
    const loginAttemptRepository = new InMemoryLoginAttemptRepository();
    const eventPublisher = new CollectingEventPublisher();
    const auditLogWriter = new CollectingAuditLogWriter();

    const useCase = new CustomerLoginUseCase(
      userRepository,
      deviceSessionRepository,
      tokenFamilyRepository,
      loginAttemptRepository,
      new FakePasswordHasher(),
      new FakeOpaqueTokenService(),
      new FakeTokenService(),
      new ImmediateUnitOfWork(),
      eventPublisher,
      new FixedClock(fixedNow),
      new SequentialIdGenerator([tokenFamilyId, sessionId, loginAttemptId, eventId]),
      new InMemorySystemConfiguration(),
      new FixedAuthTokenTtl(900),
      auditLogWriter,
    );

    return {
      useCase,
      userRepository,
      deviceSessionRepository,
      tokenFamilyRepository,
      loginAttemptRepository,
      eventPublisher,
      auditLogWriter,
    };
  }

  it('authenticates a Customer by phone + password and issues tokens (no email involved anywhere)', async () => {
    const userRepository = new InMemoryUserRepository();
    await userRepository.save(createCustomer());
    const { useCase, deviceSessionRepository, tokenFamilyRepository } = createUseCase({
      userRepository,
    });

    const result = await useCase.execute({
      countryCode: 'SY',
      phoneNumber: '0912345678',
      password,
      ipAddress: '203.0.113.10',
    });

    expect(result.actorType).toBe(AccessTokenActorType.User);
    expect(result.user.username).toBe('jane_doe');
    expect(result.user.phone).toBe('+963912345678');
    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(deviceSessionRepository.sessions).toHaveLength(1);
    expect(tokenFamilyRepository.families).toHaveLength(1);
  });

  it('rejects an unknown phone with the same generic error as a wrong password (no enumeration)', async () => {
    const { useCase } = createUseCase();

    await expect(
      useCase.execute({
        countryCode: 'SY',
        phoneNumber: '0999999999',
        password,
        ipAddress: '203.0.113.10',
      }),
    ).rejects.toThrow(InvalidCredentialsException);
  });

  it('rejects a wrong password', async () => {
    const userRepository = new InMemoryUserRepository();
    await userRepository.save(createCustomer());
    const { useCase } = createUseCase({ userRepository });

    await expect(
      useCase.execute({
        countryCode: 'SY',
        phoneNumber: '0912345678',
        password: 'WrongPassword123!',
        ipAddress: '203.0.113.10',
      }),
    ).rejects.toThrow(InvalidCredentialsException);
  });

  it('normalizes equivalent phone formatting to the same canonical login identity', async () => {
    const userRepository = new InMemoryUserRepository();
    await userRepository.save(createCustomer());
    const { useCase } = createUseCase({ userRepository });

    // Same real number, entered without the leading trunk zero.
    const result = await useCase.execute({
      countryCode: 'SY',
      phoneNumber: '912345678',
      password,
      ipAddress: '203.0.113.10',
    });

    expect(result.user.phone).toBe('+963912345678');
  });
});
