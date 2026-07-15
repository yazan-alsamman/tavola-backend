import { RefreshSessionUseCase } from './refresh-session.use-case';
import { RegistrationPolicy } from '../../domain/services/registration-policy';
import { Email } from '@shared/domain/value-objects/email.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import {
  DeviceType,
  SessionRevokeReason,
  UserStatus,
} from '../../domain/enums/authentication.enums';
import {
  SessionRefreshedEvent,
  TokenFamilyCompromisedEvent,
  TokenReplayDetectedEvent,
} from '../../domain/events/authentication.events';
import { InvalidRefreshTokenException } from '../exceptions/invalid-refresh-token.exception';
import { AccountSuspendedException } from '../exceptions/login.exceptions';
import { AccessTokenActorType } from '../../domain/services/access-token-claims';
import { User } from '../../domain/entities/user.entity';
import { DeviceSession } from '../../domain/entities/device-session.entity';
import { TokenFamily } from '../../domain/entities/token-family.entity';
import { SessionPolicy } from '../../domain/services/authentication-policies';
import { SessionRevokedException } from '../../domain/exceptions/session-revoked.exception';
import { TokenFamilyCompromisedException } from '../../domain/exceptions/token-family-compromised.exception';
import { SessionId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CollectingEventPublisher,
  FakeOpaqueTokenService,
  FakeTokenService,
  FixedAuthRefreshPolicy,
  FixedAuthTokenTtl,
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryDeviceSessionRepository,
  InMemoryEmployeeAccessResolver,
  InMemoryLoginOrganizationReader,
  InMemorySystemConfiguration,
  InMemoryTokenFamilyRepository,
  InMemoryUserRepository,
  UuidGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { SYSTEM_CONFIG_KEYS } from '@shared/application/ports/system-configuration.port';

describe('RefreshSessionUseCase', () => {
  const fixedNow = new Date('2026-07-07T18:00:00.000Z');
  const userId = '11111111-1111-4111-8111-111111111111';
  const tokenFamilyId = '22222222-2222-4222-8222-222222222222';
  const sessionId = '33333333-3333-4333-8333-333333333333';
  const refreshToken = 'opaque-token-0';
  const refreshHash = 'sha256-opaque-token-0';

  function createActiveUser(overrides?: Partial<ReturnType<User['toProps']>>): User {
    const base = RegistrationPolicy.createPendingUser({
      id: userId,
      email: Email.create('refresh@example.com'),
      passwordHash: PasswordHash.create('argon2id$fake$SecurePass123!'),
      firstName: 'Refresh',
      lastName: 'User',
      phone: null,
      language: 'en',
      at: fixedNow,
    }).verifyEmail(fixedNow);

    return User.reconstitute({ ...base.toProps(), ...overrides });
  }

  async function seedSession(
    deviceSessionRepository: InMemoryDeviceSessionRepository,
    tokenFamilyRepository: InMemoryTokenFamilyRepository,
    overrides?: {
      sessionVersion?: number;
      permissionsVersion?: number;
      revokedAt?: Date | null;
      expiresAt?: Date;
      refreshTokenHash?: string;
      previousRefreshTokenHash?: string | null;
      lastUsedAt?: Date | null;
      familyCompromisedAt?: Date | null;
    },
  ) {
    await tokenFamilyRepository.save(
      TokenFamily.create({
        id: tokenFamilyId,
        userId,
        compromisedAt: overrides?.familyCompromisedAt ?? null,
        revokedAt: overrides?.familyCompromisedAt ?? null,
        createdAt: fixedNow,
      }),
    );

    await deviceSessionRepository.save(
      DeviceSession.create({
        id: sessionId,
        userId,
        tokenFamilyId,
        refreshTokenHash: overrides?.refreshTokenHash ?? refreshHash,
        previousRefreshTokenHash: overrides?.previousRefreshTokenHash ?? null,
        deviceName: 'Test Device',
        deviceType: DeviceType.Web,
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
        sessionVersion: overrides?.sessionVersion ?? 1,
        permissionsVersion: overrides?.permissionsVersion ?? 1,
        lastUsedAt: overrides?.lastUsedAt ?? fixedNow,
        revokedAt: overrides?.revokedAt ?? null,
        revokedReason: null,
        expiresAt: overrides?.expiresAt ?? SessionPolicy.calculateRefreshExpiry(fixedNow, 30),
        createdAt: fixedNow,
      }),
    );
  }

  function createUseCase(overrides?: {
    userRepository?: InMemoryUserRepository;
    deviceSessionRepository?: InMemoryDeviceSessionRepository;
    tokenFamilyRepository?: InMemoryTokenFamilyRepository;
    eventPublisher?: CollectingEventPublisher;
    clock?: FixedClock;
    organizationReader?: InMemoryLoginOrganizationReader;
    employeeAccessResolver?: InMemoryEmployeeAccessResolver;
  }) {
    const userRepository = overrides?.userRepository ?? new InMemoryUserRepository();
    const deviceSessionRepository =
      overrides?.deviceSessionRepository ?? new InMemoryDeviceSessionRepository();
    const tokenFamilyRepository =
      overrides?.tokenFamilyRepository ?? new InMemoryTokenFamilyRepository();
    const eventPublisher = overrides?.eventPublisher ?? new CollectingEventPublisher();

    const useCase = new RefreshSessionUseCase(
      userRepository,
      deviceSessionRepository,
      tokenFamilyRepository,
      new FakeOpaqueTokenService(),
      new FakeTokenService(),
      new ImmediateUnitOfWork(),
      eventPublisher,
      overrides?.clock ?? new FixedClock(fixedNow),
      new UuidGenerator(),
      new InMemorySystemConfiguration({
        [SYSTEM_CONFIG_KEYS.refreshTokenTtlDays]: 30,
      }),
      new FixedAuthTokenTtl(900),
      new FixedAuthRefreshPolicy(30_000),
      overrides?.organizationReader ?? new InMemoryLoginOrganizationReader(),
      overrides?.employeeAccessResolver ?? new InMemoryEmployeeAccessResolver(),
    );

    return {
      useCase,
      userRepository,
      deviceSessionRepository,
      tokenFamilyRepository,
      eventPublisher,
    };
  }

  it('rotates refresh token and issues a new access token', async () => {
    const {
      useCase,
      userRepository,
      deviceSessionRepository,
      tokenFamilyRepository,
      eventPublisher,
    } = createUseCase();
    await userRepository.save(createActiveUser());
    await seedSession(deviceSessionRepository, tokenFamilyRepository);

    const result = await useCase.execute({ refreshToken });

    expect(result.accessToken).toBe(`jwt.${userId}.${sessionId}`);
    expect(result.refreshToken).toBe('opaque-token-1');
    expect(result.tokenType).toBe('Bearer');
    expect(result.sessionId).toBe(sessionId);
    expect(result.sessionVersion).toBe(1);
    expect(result.permissionsVersion).toBe(1);
    expect(result.actorType).toBe(AccessTokenActorType.User);
    expect(result.issuedAt).toEqual(fixedNow);
    expect(result.serverTime).toEqual(fixedNow);
    expect(result.accessTokenExpiresAt).toEqual(new Date('2026-07-07T18:15:00.000Z'));

    const stored = (await deviceSessionRepository.findById(SessionId.create(sessionId)))!;
    expect(stored.refreshTokenHash.value).toBe('sha256-opaque-token-1');
    expect(stored.toProps().previousRefreshTokenHash).toBe(refreshHash);

    expect(eventPublisher.events).toHaveLength(1);
    expect(eventPublisher.events[0]).toBeInstanceOf(SessionRefreshedEvent);
  });

  it('rejects empty refresh token', async () => {
    const { useCase } = createUseCase();
    await expect(useCase.execute({ refreshToken: '  ' })).rejects.toBeInstanceOf(
      InvalidRefreshTokenException,
    );
  });

  it('rejects unknown refresh token', async () => {
    const { useCase } = createUseCase();
    await expect(useCase.execute({ refreshToken: 'unknown-token' })).rejects.toBeInstanceOf(
      InvalidRefreshTokenException,
    );
  });

  it('rejects expired session', async () => {
    const { useCase, userRepository, deviceSessionRepository, tokenFamilyRepository } =
      createUseCase();
    await userRepository.save(createActiveUser());
    await seedSession(deviceSessionRepository, tokenFamilyRepository, {
      expiresAt: new Date('2026-07-06T18:00:00.000Z'),
    });

    await expect(useCase.execute({ refreshToken })).rejects.toBeInstanceOf(SessionRevokedException);
  });

  it('rejects revoked session', async () => {
    const { useCase, userRepository, deviceSessionRepository, tokenFamilyRepository } =
      createUseCase();
    await userRepository.save(createActiveUser());
    await seedSession(deviceSessionRepository, tokenFamilyRepository, {
      revokedAt: fixedNow,
    });

    await expect(useCase.execute({ refreshToken })).rejects.toBeInstanceOf(SessionRevokedException);
  });

  it('rejects compromised token family', async () => {
    const { useCase, userRepository, deviceSessionRepository, tokenFamilyRepository } =
      createUseCase();
    await userRepository.save(createActiveUser());
    await seedSession(deviceSessionRepository, tokenFamilyRepository, {
      familyCompromisedAt: fixedNow,
    });

    await expect(useCase.execute({ refreshToken })).rejects.toBeInstanceOf(
      TokenFamilyCompromisedException,
    );
  });

  it('rejects stale session version', async () => {
    const { useCase, userRepository, deviceSessionRepository, tokenFamilyRepository } =
      createUseCase();
    await userRepository.save(createActiveUser({ sessionVersion: 2 }));
    await seedSession(deviceSessionRepository, tokenFamilyRepository, {
      sessionVersion: 1,
    });

    await expect(useCase.execute({ refreshToken })).rejects.toBeInstanceOf(
      InvalidRefreshTokenException,
    );
  });

  it('rejects refresh when user is missing', async () => {
    const { useCase, deviceSessionRepository, tokenFamilyRepository } = createUseCase();
    await seedSession(deviceSessionRepository, tokenFamilyRepository);

    await expect(useCase.execute({ refreshToken })).rejects.toBeInstanceOf(
      InvalidRefreshTokenException,
    );
  });

  it('rejects refresh when user cannot authenticate', async () => {
    const { useCase, userRepository, deviceSessionRepository, tokenFamilyRepository } =
      createUseCase();
    await userRepository.save(
      createActiveUser({ status: UserStatus.Suspended, emailVerified: true }),
    );
    await seedSession(deviceSessionRepository, tokenFamilyRepository);

    await expect(useCase.execute({ refreshToken })).rejects.toBeInstanceOf(
      AccountSuspendedException,
    );
  });

  it('invalidates the previous refresh token after rotation', async () => {
    const { useCase, userRepository, deviceSessionRepository, tokenFamilyRepository } =
      createUseCase();
    await userRepository.save(createActiveUser());
    await seedSession(deviceSessionRepository, tokenFamilyRepository);

    const first = await useCase.execute({ refreshToken });
    await expect(useCase.execute({ refreshToken })).rejects.toBeInstanceOf(
      InvalidRefreshTokenException,
    );
    await expect(useCase.execute({ refreshToken: first.refreshToken })).resolves.toEqual(
      expect.objectContaining({ refreshToken: 'opaque-token-2' }),
    );
  });

  it('treats superseded token within grace window as invalid without compromising family', async () => {
    const {
      useCase,
      userRepository,
      deviceSessionRepository,
      tokenFamilyRepository,
      eventPublisher,
    } = createUseCase();
    await userRepository.save(createActiveUser());
    await seedSession(deviceSessionRepository, tokenFamilyRepository, {
      refreshTokenHash: 'sha256-opaque-token-1',
      previousRefreshTokenHash: refreshHash,
      lastUsedAt: fixedNow,
    });

    await expect(useCase.execute({ refreshToken })).rejects.toBeInstanceOf(
      InvalidRefreshTokenException,
    );
    expect(eventPublisher.events).toHaveLength(0);
    const family = (await tokenFamilyRepository.findById(
      tokenFamilyRepository.families[0]!.tokenFamilyId,
    ))!;
    expect(family.isCompromised()).toBe(false);
  });

  it('compromises family and publishes security events on replay after grace window', async () => {
    const replayTime = new Date('2026-07-07T18:01:00.000Z');
    const {
      useCase,
      userRepository,
      deviceSessionRepository,
      tokenFamilyRepository,
      eventPublisher,
    } = createUseCase({ clock: new FixedClock(replayTime) });
    await userRepository.save(createActiveUser());
    await seedSession(deviceSessionRepository, tokenFamilyRepository, {
      refreshTokenHash: 'sha256-opaque-token-1',
      previousRefreshTokenHash: refreshHash,
      lastUsedAt: fixedNow,
    });

    await expect(
      useCase.execute({ refreshToken, ipAddress: '203.0.113.10' }),
    ).rejects.toBeInstanceOf(InvalidRefreshTokenException);

    const family = (await tokenFamilyRepository.findById(
      tokenFamilyRepository.families[0]!.tokenFamilyId,
    ))!;
    expect(family.isCompromised()).toBe(true);

    const session = (await deviceSessionRepository.findById(SessionId.create(sessionId)))!;
    expect(session.toProps().revokedReason).toBe(SessionRevokeReason.ReuseDetected);

    expect(eventPublisher.events.map((event) => event.eventName)).toEqual([
      'TokenReplayDetected',
      'TokenFamilyCompromised',
      'SessionFamilyRevoked',
      'SessionRevoked',
    ]);
    expect(eventPublisher.events[0]).toBeInstanceOf(TokenReplayDetectedEvent);
    expect(eventPublisher.events[1]).toBeInstanceOf(TokenFamilyCompromisedEvent);
  });

  it('re-resolves Employee permissions on every refresh rather than reusing stale claims', async () => {
    const employeeAccessResolver = new InMemoryEmployeeAccessResolver({
      employeeId: 'employee-1',
      organizationId: 'org-1',
      restaurantId: 'restaurant-1',
      branchIds: ['branch-1'],
      permissions: ['reservations:approve'],
      permissionsVersion: 5,
    });
    const { useCase, userRepository, deviceSessionRepository, tokenFamilyRepository } =
      createUseCase({ employeeAccessResolver });
    await userRepository.save(createActiveUser());
    await seedSession(deviceSessionRepository, tokenFamilyRepository, { permissionsVersion: 1 });

    const result = await useCase.execute({ refreshToken });

    expect(result.actorType).toBe(AccessTokenActorType.Employee);
    expect(result.permissionsVersion).toBe(5);

    const stored = (await deviceSessionRepository.findById(SessionId.create(sessionId)))!;
    expect(stored.toProps().permissionsVersion).toBe(5);
  });

  it('issues OrganizationMember actor claims on refresh for an org member with no Employee record', async () => {
    const organizationReader = new InMemoryLoginOrganizationReader({
      organizationId: 'org-1',
      name: 'Acme',
      slug: 'acme',
      role: 'Admin',
    });
    const { useCase, userRepository, deviceSessionRepository, tokenFamilyRepository } =
      createUseCase({ organizationReader });
    await userRepository.save(createActiveUser());
    await seedSession(deviceSessionRepository, tokenFamilyRepository);

    const result = await useCase.execute({ refreshToken });

    expect(result.actorType).toBe(AccessTokenActorType.OrganizationMember);
    expect(result.permissionsVersion).toBe(1);
  });
});
