import { LoginUseCase } from './login.use-case';
import { RegistrationPolicy } from '../../domain/services/registration-policy';
import { Email } from '@shared/domain/value-objects/email.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { UserStatus, DeviceType } from '../../domain/enums/authentication.enums';
import { AccountLockedEvent, UserLoggedInEvent } from '../../domain/events/authentication.events';
import { InvalidCredentialsException } from '../exceptions/login.exceptions';
import { AccountLockedException } from '../exceptions/login.exceptions';
import { EmailNotVerifiedException } from '../exceptions/login.exceptions';
import { AccountSuspendedException } from '../exceptions/login.exceptions';
import { TooManySessionsException } from '../exceptions/too-many-sessions.exception';
import { AccessTokenActorType } from '../../domain/services/access-token-claims';
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
  InMemoryEmployeeAccessResolver,
  InMemoryLoginAttemptRepository,
  InMemoryLoginOrganizationReader,
  InMemorySystemConfiguration,
  InMemoryTokenFamilyRepository,
  InMemoryUserRepository,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryEmployeeRepository } from '../../../../../test/authorization/support/in-memory-employee.repository';
import { SYSTEM_CONFIG_KEYS } from '@shared/application/ports/system-configuration.port';
import { DeviceSession } from '../../domain/entities/device-session.entity';
import { SessionPolicy } from '../../domain/services/authentication-policies';
import { TIMING_SAFE_DUMMY_PASSWORD_HASH } from '../../domain/services/timing-safe-dummy';
import { Employee } from '@modules/authorization/domain/entities/employee.entity';
import { EmployeeStatus } from '@modules/authorization/domain/enums/authorization.enums';
import { EmployeeId } from '@shared/domain/value-objects/identifiers.vo';

describe('LoginUseCase', () => {
  const fixedNow = new Date('2026-07-07T18:00:00.000Z');
  const userId = '11111111-1111-4111-8111-111111111111';
  const tokenFamilyId = '22222222-2222-4222-8222-222222222222';
  const sessionId = '33333333-3333-4333-8333-333333333333';
  const loginAttemptId = '44444444-4444-4444-8444-444444444444';
  const eventId = '55555555-5555-4555-8555-555555555555';
  const password = 'SecurePass123!';

  function createActiveUser(overrides?: Partial<ReturnType<User['toProps']>>): User {
    const base = RegistrationPolicy.createPendingUser({
      id: userId,
      email: Email.create('login@example.com'),
      passwordHash: PasswordHash.create('argon2id$fake$SecurePass123!'),
      firstName: 'Login',
      lastName: 'User',
      phone: null,
      language: 'en',
      at: fixedNow,
    }).verifyEmail(fixedNow);

    return User.reconstitute({ ...base.toProps(), ...overrides });
  }

  function createUseCase(overrides?: {
    userRepository?: InMemoryUserRepository;
    deviceSessionRepository?: InMemoryDeviceSessionRepository;
    tokenFamilyRepository?: InMemoryTokenFamilyRepository;
    loginAttemptRepository?: InMemoryLoginAttemptRepository;
    eventPublisher?: CollectingEventPublisher;
    systemConfiguration?: InMemorySystemConfiguration;
    organizationReader?: InMemoryLoginOrganizationReader;
    employeeAccessResolver?: InMemoryEmployeeAccessResolver;
    employeeRepository?: InMemoryEmployeeRepository;
    unitOfWork?: ImmediateUnitOfWork;
    auditLogWriter?: CollectingAuditLogWriter;
  }) {
    const userRepository = overrides?.userRepository ?? new InMemoryUserRepository();
    const deviceSessionRepository =
      overrides?.deviceSessionRepository ?? new InMemoryDeviceSessionRepository();
    const tokenFamilyRepository =
      overrides?.tokenFamilyRepository ?? new InMemoryTokenFamilyRepository();
    const loginAttemptRepository =
      overrides?.loginAttemptRepository ?? new InMemoryLoginAttemptRepository();
    const eventPublisher = overrides?.eventPublisher ?? new CollectingEventPublisher();
    const auditLogWriter = overrides?.auditLogWriter ?? new CollectingAuditLogWriter();

    const useCase = new LoginUseCase(
      userRepository,
      deviceSessionRepository,
      tokenFamilyRepository,
      loginAttemptRepository,
      new FakePasswordHasher(),
      new FakeOpaqueTokenService(),
      new FakeTokenService(),
      overrides?.unitOfWork ?? new ImmediateUnitOfWork(),
      eventPublisher,
      new FixedClock(fixedNow),
      new SequentialIdGenerator([tokenFamilyId, sessionId, loginAttemptId, eventId]),
      overrides?.systemConfiguration ??
        new InMemorySystemConfiguration({
          [SYSTEM_CONFIG_KEYS.maxFailedLoginAttempts]: 5,
          [SYSTEM_CONFIG_KEYS.accountLockDurationMinutes]: 30,
          [SYSTEM_CONFIG_KEYS.maxActiveSessionsPerUser]: 2,
          [SYSTEM_CONFIG_KEYS.refreshTokenTtlDays]: 30,
        }),
      new FixedAuthTokenTtl(900),
      overrides?.organizationReader ?? new InMemoryLoginOrganizationReader(),
      overrides?.employeeAccessResolver ?? new InMemoryEmployeeAccessResolver(),
      overrides?.employeeRepository ?? new InMemoryEmployeeRepository(),
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

  it('logs in an active verified user and creates session artifacts', async () => {
    const organizationReader = new InMemoryLoginOrganizationReader({
      organizationId: 'org-1',
      name: 'Acme',
      slug: 'acme',
      role: 'Owner',
    });
    const {
      useCase,
      userRepository,
      deviceSessionRepository,
      tokenFamilyRepository,
      eventPublisher,
      auditLogWriter,
    } = createUseCase({ organizationReader });

    await userRepository.save(createActiveUser());

    const result = await useCase.execute({
      email: 'login@example.com',
      password,
      deviceName: 'Pixel',
      deviceType: DeviceType.Mobile,
      ipAddress: '203.0.113.10',
      userAgent: 'jest',
    });

    expect(result.accessToken).toBe(`jwt.${userId}.${sessionId}`);
    expect(result.refreshToken).toBe('opaque-token-1');
    expect(result.sessionId).toBe(sessionId);
    expect(result.sessionVersion).toBe(1);
    expect(result.permissionsVersion).toBe(1);
    // The seeded user has an active OrganizationMember record, so Phase 2.14
    // correctly resolves actorType to OrganizationMember rather than always
    // defaulting to User (see AccessTokenClaimsBuilder).
    expect(result.actorType).toBe(AccessTokenActorType.OrganizationMember);
    expect(result.organization).toEqual({
      organizationId: 'org-1',
      name: 'Acme',
      slug: 'acme',
      role: 'Owner',
    });
    expect(result.requiresPasswordChange).toBe(false);

    const savedUser = (await userRepository.findById(
      (await import('@shared/domain/value-objects/identifiers.vo')).UserId.create(userId),
    ))!;
    expect(savedUser.failedLoginCount).toBe(0);
    expect(savedUser.toProps().lastLoginAt).toEqual(fixedNow);

    expect(tokenFamilyRepository.families).toHaveLength(1);
    expect(deviceSessionRepository.sessions).toHaveLength(1);
    expect(deviceSessionRepository.sessions[0].refreshTokenHash.value).toBe(
      'sha256-opaque-token-1',
    );
    expect(eventPublisher.events[0]).toBeInstanceOf(UserLoggedInEvent);
    // Success-path auditing goes through AuditingEventPublisher decorating
    // EVENT_PUBLISHER in production (see auditing-event-publisher.spec.ts) -
    // LoginUseCase's own direct `auditLogWriter` is only used on failure/lock
    // paths, so it must stay empty here.
    expect(auditLogWriter.entries).toHaveLength(0);
  });

  it('rejects unknown email with invalid credentials', async () => {
    const { useCase, loginAttemptRepository, auditLogWriter } = createUseCase();

    await expect(
      useCase.execute({
        email: 'missing@example.com',
        password,
        ipAddress: '127.0.0.1',
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsException);

    expect(loginAttemptRepository.attempts).toHaveLength(1);
    expect(loginAttemptRepository.attempts[0].success).toBe(false);
    expect(auditLogWriter.entries).toHaveLength(1);
    expect(auditLogWriter.entries[0]).toMatchObject({
      action: 'auth.login.failed',
      actorId: null,
      ipAddress: '127.0.0.1',
    });
  });

  // Phase 2.22 security-audit regression test: an unknown email must still
  // perform an Argon2-equivalent verify() call (against the shared dummy
  // hash) so its response timing is indistinguishable from a known email with
  // a wrong password - otherwise account existence leaks via timing
  // (AUTHENTICATION_ARCHITECTURE.md §12.1 "User enumeration (login)").
  it('verifies against the timing-safe dummy hash for an unknown email, not skipping the hash comparison', async () => {
    const { useCase, userRepository } = createUseCase();
    const verifySpy = jest.spyOn(FakePasswordHasher.prototype, 'verify');

    await expect(
      useCase.execute({
        email: 'still-missing@example.com',
        password,
        ipAddress: '127.0.0.1',
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsException);

    expect(verifySpy).toHaveBeenCalledTimes(1);
    const [, hashArg] = verifySpy.mock.calls[0];
    expect((hashArg as PasswordHash).value).toBe(TIMING_SAFE_DUMMY_PASSWORD_HASH);
    expect(await userRepository.findByEmail(Email.create('still-missing@example.com'))).toBeNull();

    verifySpy.mockRestore();
  });

  it('rejects wrong password and records failed login', async () => {
    const { useCase, userRepository, loginAttemptRepository, auditLogWriter } = createUseCase();
    await userRepository.save(createActiveUser());

    await expect(
      useCase.execute({
        email: 'login@example.com',
        password: 'WrongPass123!',
        ipAddress: '127.0.0.1',
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsException);

    const savedUser = (await userRepository.findById(
      (await import('@shared/domain/value-objects/identifiers.vo')).UserId.create(userId),
    ))!;
    expect(savedUser.failedLoginCount).toBe(1);
    expect(loginAttemptRepository.attempts[0].success).toBe(false);
    expect(auditLogWriter.entries).toHaveLength(1);
    expect(auditLogWriter.entries[0]).toMatchObject({
      action: 'auth.login.failed',
      actorId: userId,
      targetType: 'User',
      targetId: userId,
    });
  });

  it('rejects pending users with email not verified', async () => {
    const { useCase, userRepository, auditLogWriter } = createUseCase();
    await userRepository.save(
      RegistrationPolicy.createPendingUser({
        id: userId,
        email: Email.create('login@example.com'),
        passwordHash: PasswordHash.create('argon2id$fake$SecurePass123!'),
        firstName: 'Pending',
        lastName: 'User',
        phone: null,
        language: 'en',
        at: fixedNow,
      }),
    );

    await expect(
      useCase.execute({
        email: 'login@example.com',
        password,
        ipAddress: '127.0.0.1',
      }),
    ).rejects.toBeInstanceOf(EmailNotVerifiedException);

    expect(auditLogWriter.entries).toHaveLength(1);
    expect(auditLogWriter.entries[0].action).toBe('auth.login.blocked_unverified');
  });

  it('rejects suspended users', async () => {
    const { useCase, userRepository, auditLogWriter } = createUseCase();
    await userRepository.save(
      createActiveUser({ status: UserStatus.Suspended, emailVerified: true }),
    );

    await expect(
      useCase.execute({
        email: 'login@example.com',
        password,
        ipAddress: '127.0.0.1',
      }),
    ).rejects.toBeInstanceOf(AccountSuspendedException);

    expect(auditLogWriter.entries).toHaveLength(1);
    expect(auditLogWriter.entries[0].action).toBe('auth.login.blocked_suspended');
  });

  it('rejects locked users until cooldown expires', async () => {
    const { useCase, userRepository, auditLogWriter } = createUseCase();
    await userRepository.save(
      createActiveUser({
        status: UserStatus.Locked,
        lockedUntil: new Date(fixedNow.getTime() + 60_000),
      }),
    );

    await expect(
      useCase.execute({
        email: 'login@example.com',
        password,
        ipAddress: '127.0.0.1',
      }),
    ).rejects.toBeInstanceOf(AccountLockedException);

    expect(auditLogWriter.entries).toHaveLength(1);
    expect(auditLogWriter.entries[0].action).toBe('auth.login.blocked_locked');
  });

  it('locks account after max failed attempts and publishes AccountLockedEvent (not a direct audit write)', async () => {
    const { useCase, userRepository, auditLogWriter, eventPublisher } = createUseCase();
    await userRepository.save(createActiveUser({ failedLoginCount: 4 }));

    await expect(
      useCase.execute({
        email: 'login@example.com',
        password: 'WrongPass123!',
        ipAddress: '127.0.0.1',
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsException);

    const savedUser = (await userRepository.findById(
      (await import('@shared/domain/value-objects/identifiers.vo')).UserId.create(userId),
    ))!;
    expect(savedUser.status).toBe(UserStatus.Locked);
    expect(savedUser.failedLoginCount).toBe(5);
    expect(savedUser.lockedUntil).not.toBeNull();

    const lockedEvent = eventPublisher.events.find(
      (event): event is AccountLockedEvent => event instanceof AccountLockedEvent,
    );
    expect(lockedEvent).toBeDefined();
    expect(lockedEvent?.payload).toMatchObject({
      userId,
      failedAttempts: 5,
      lockedUntil: savedUser.lockedUntil,
    });

    // Phase 2.19: AccountLocked is now published as a proper domain event,
    // flowing to the audit trail via AuditingEventPublisher in production
    // (see auditing-event-publisher.spec.ts) - LoginUseCase's own direct
    // `auditLogWriter` no longer records this action, only auth.login.failed.
    const actions = auditLogWriter.entries.map((entry) => entry.action);
    expect(actions).not.toContain('auth.account.locked');
    expect(actions).toContain('auth.login.failed');
  });

  it('rejects login when active session cap is reached', async () => {
    const deviceSessionRepository = new InMemoryDeviceSessionRepository();
    const { useCase, userRepository } = createUseCase({ deviceSessionRepository });
    await userRepository.save(createActiveUser());

    const refreshExpiry = SessionPolicy.calculateRefreshExpiry(fixedNow, 30);
    const existingFamilies = [
      '66666666-6666-4666-8666-666666666666',
      '77777777-7777-4777-8777-777777777777',
    ];
    const existingSessions = [
      '88888888-8888-4888-8888-888888888888',
      '99999999-9999-4999-8999-999999999999',
    ];
    for (const [index, familyId] of existingFamilies.entries()) {
      await deviceSessionRepository.save(
        DeviceSession.create({
          id: existingSessions[index]!,
          userId,
          tokenFamilyId: familyId,
          refreshTokenHash: `hash-${index}`,
          previousRefreshTokenHash: null,
          deviceName: null,
          deviceType: DeviceType.Unknown,
          ipAddress: null,
          userAgent: null,
          sessionVersion: 1,
          permissionsVersion: 1,
          lastUsedAt: fixedNow,
          revokedAt: null,
          revokedReason: null,
          expiresAt: refreshExpiry,
          createdAt: fixedNow,
        }),
      );
    }

    await expect(
      useCase.execute({
        email: 'login@example.com',
        password,
        ipAddress: '127.0.0.1',
      }),
    ).rejects.toBeInstanceOf(TooManySessionsException);
  });

  it('allows login after lock expiry with correct password', async () => {
    const { useCase, userRepository } = createUseCase();
    await userRepository.save(
      createActiveUser({
        status: UserStatus.Locked,
        failedLoginCount: 5,
        lockedUntil: new Date(fixedNow.getTime() - 1_000),
      }),
    );

    const result = await useCase.execute({
      email: 'login@example.com',
      password,
      ipAddress: '127.0.0.1',
    });

    expect(result.user.status).toBe(UserStatus.Active);
  });

  it('does not publish UserLoggedInEvent when the transaction rolls back', async () => {
    class ThrowingDeviceSessionRepository extends InMemoryDeviceSessionRepository {
      async save(): Promise<void> {
        throw new Error('simulated transaction failure');
      }
    }
    const deviceSessionRepository = new ThrowingDeviceSessionRepository();
    const { useCase, userRepository, eventPublisher, auditLogWriter } = createUseCase({
      deviceSessionRepository,
    });
    await userRepository.save(createActiveUser());

    await expect(
      useCase.execute({
        email: 'login@example.com',
        password,
        ipAddress: '127.0.0.1',
      }),
    ).rejects.toThrow('simulated transaction failure');

    expect(eventPublisher.events).toHaveLength(0);
    expect(auditLogWriter.entries).toHaveLength(0);
  });

  it('issues Employee actor claims and permissions when an active Employee record is linked', async () => {
    const employeeAccessResolver = new InMemoryEmployeeAccessResolver({
      employeeId: 'employee-1',
      organizationId: 'org-1',
      restaurantId: 'restaurant-1',
      branchIds: [],
      permissions: ['reservations:approve', 'tables:manage'],
      permissionsVersion: 3,
    });
    const { useCase, userRepository, deviceSessionRepository } = createUseCase({
      employeeAccessResolver,
    });
    await userRepository.save(createActiveUser());

    const result = await useCase.execute({
      email: 'login@example.com',
      password,
      ipAddress: '127.0.0.1',
    });

    expect(result.actorType).toBe(AccessTokenActorType.Employee);
    expect(result.permissionsVersion).toBe(3);
    expect(deviceSessionRepository.sessions[0].toProps().permissionsVersion).toBe(3);
  });

  it('issues OrganizationMember actor claims for a user with no Employee record', async () => {
    const organizationReader = new InMemoryLoginOrganizationReader({
      organizationId: 'org-1',
      name: 'Acme',
      slug: 'acme',
      role: 'Owner',
    });
    const { useCase, userRepository } = createUseCase({ organizationReader });
    await userRepository.save(createActiveUser());

    const result = await useCase.execute({
      email: 'login@example.com',
      password,
      ipAddress: '127.0.0.1',
    });

    expect(result.actorType).toBe(AccessTokenActorType.OrganizationMember);
    expect(result.permissionsVersion).toBe(1);
    expect(result.organization?.role).toBe('Owner');
  });

  it('prefers the Employee actor over OrganizationMember when a user holds both records', async () => {
    const organizationReader = new InMemoryLoginOrganizationReader({
      organizationId: 'org-1',
      name: 'Acme',
      slug: 'acme',
      role: 'Owner',
    });
    const employeeAccessResolver = new InMemoryEmployeeAccessResolver({
      employeeId: 'employee-1',
      organizationId: 'org-1',
      restaurantId: 'restaurant-1',
      branchIds: ['branch-1'],
      permissions: ['reservations:approve'],
      permissionsVersion: 2,
    });
    const { useCase, userRepository } = createUseCase({
      organizationReader,
      employeeAccessResolver,
    });
    await userRepository.save(createActiveUser());

    const result = await useCase.execute({
      email: 'login@example.com',
      password,
      ipAddress: '127.0.0.1',
    });

    expect(result.actorType).toBe(AccessTokenActorType.Employee);
    expect(result.permissionsVersion).toBe(2);
    // The org-admin relationship is still surfaced informationally even when
    // the JWT actorType is Employee - see AccessTokenClaimsBuilder's doc comment.
    expect(result.organization?.role).toBe('Owner');
  });

  it('links a pending Invited Employee record to the User on first login (Phase 7.0)', async () => {
    const employeeRepository = new InMemoryEmployeeRepository();
    const pendingEmployeeId = '99999999-9999-4999-8999-999999999991';
    await employeeRepository.save(
      Employee.create({
        id: pendingEmployeeId,
        restaurantId: 'restaurant-1',
        roleId: 'role-1',
        userId: null,
        permissionsVersion: 1,
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'login@example.com',
        phone: null,
        status: EmployeeStatus.Invited,
        assignedBranchIds: [],
        createdAt: fixedNow,
        updatedAt: fixedNow,
        deletedAt: null,
      }),
    );
    const { useCase, userRepository } = createUseCase({ employeeRepository });
    await userRepository.save(createActiveUser());

    await useCase.execute({
      email: 'login@example.com',
      password,
      ipAddress: '127.0.0.1',
    });

    const linked = await employeeRepository.findById(EmployeeId.create(pendingEmployeeId));
    expect(linked?.status).toBe(EmployeeStatus.Active);
    expect(linked?.userId?.value).toBe(userId);
  });

  it('does not link an Employee record for a different email', async () => {
    const employeeRepository = new InMemoryEmployeeRepository();
    const otherEmployeeId = '99999999-9999-4999-8999-999999999992';
    await employeeRepository.save(
      Employee.create({
        id: otherEmployeeId,
        restaurantId: 'restaurant-1',
        roleId: 'role-1',
        userId: null,
        permissionsVersion: 1,
        firstName: 'Someone',
        lastName: 'Else',
        email: 'unrelated@example.com',
        phone: null,
        status: EmployeeStatus.Invited,
        assignedBranchIds: [],
        createdAt: fixedNow,
        updatedAt: fixedNow,
        deletedAt: null,
      }),
    );
    const { useCase, userRepository } = createUseCase({ employeeRepository });
    await userRepository.save(createActiveUser());

    await useCase.execute({
      email: 'login@example.com',
      password,
      ipAddress: '127.0.0.1',
    });

    const untouched = await employeeRepository.findById(EmployeeId.create(otherEmployeeId));
    expect(untouched?.status).toBe(EmployeeStatus.Invited);
    expect(untouched?.userId).toBeNull();
  });
});
