import { LoginUseCase } from '@modules/authentication/application/use-cases/login.use-case';
import { RegistrationPolicy } from '@modules/authentication/domain/services/registration-policy';
import { Email } from '@shared/domain/value-objects/email.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { UserLoggedInEvent } from '@modules/authentication/domain/events/authentication.events';
import { JwtTokenService } from '@modules/authentication/infrastructure/security/jwt-token.service';
import {
  CollectingAuditLogWriter,
  CollectingEventPublisher,
  FakeOpaqueTokenService,
  FakePasswordHasher,
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
} from './support/in-memory-registration.dependencies';
import { InMemoryEmployeeRepository } from '../authorization/support/in-memory-employee.repository';
import { SYSTEM_CONFIG_KEYS } from '@shared/application/ports/system-configuration.port';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';

describe('LoginUseCase (integration)', () => {
  const fixedNow = new Date('2026-07-07T19:00:00.000Z');
  const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  it('issues JWT claims that validate through JwtTokenService', async () => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-32-characters-long';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-characters-long';
    process.env.ARGON2_MEMORY_COST = '4096';
    process.env.ARGON2_TIME_COST = '1';

    const { Test } = await import('@nestjs/testing');
    const { ConfigModule } = await import('@nestjs/config');
    const authConfig = (await import('@config/auth.config')).default;

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, load: [authConfig] })],
      providers: [JwtTokenService],
    }).compile();

    const jwtTokenService = moduleRef.get(JwtTokenService);
    const userRepository = new InMemoryUserRepository();
    const deviceSessionRepository = new InMemoryDeviceSessionRepository();
    const tokenFamilyRepository = new InMemoryTokenFamilyRepository();
    const loginAttemptRepository = new InMemoryLoginAttemptRepository();
    const eventPublisher = new CollectingEventPublisher();

    await userRepository.save(
      RegistrationPolicy.createPendingUser({
        id: userId,
        email: Email.create('integration-login@example.com'),
        passwordHash: PasswordHash.create('argon2id$fake$SecurePass123!'),
        firstName: 'Integration',
        lastName: 'Login',
        phone: null,
        language: 'en',
        at: fixedNow,
      }).verifyEmail(fixedNow),
    );

    const idGenerator = {
      ids: [
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      ],
      index: 0,
      generate(): string {
        const id = this.ids[this.index];
        this.index += 1;
        return id ?? 'ffffffff-ffff-4fff-8fff-ffffffffffff';
      },
    };

    const useCase = new LoginUseCase(
      userRepository,
      deviceSessionRepository,
      tokenFamilyRepository,
      loginAttemptRepository,
      new FakePasswordHasher(),
      new FakeOpaqueTokenService(),
      jwtTokenService,
      new ImmediateUnitOfWork(),
      eventPublisher,
      new FixedClock(fixedNow),
      idGenerator,
      new InMemorySystemConfiguration({
        [SYSTEM_CONFIG_KEYS.maxActiveSessionsPerUser]: 10,
        [SYSTEM_CONFIG_KEYS.refreshTokenTtlDays]: 30,
      }),
      new FixedAuthTokenTtl(900),
      new InMemoryLoginOrganizationReader(),
      new InMemoryEmployeeAccessResolver(),
      new InMemoryEmployeeRepository(),
      new CollectingAuditLogWriter(),
    );

    const result = await useCase.execute({
      email: 'integration-login@example.com',
      password: 'SecurePass123!',
      ipAddress: '198.51.100.20',
      userAgent: 'integration-test',
    });

    const claims = jwtTokenService.verifyAccessToken(result.accessToken);
    expect(claims.sub).toBe(userId);
    expect(claims.actorType).toBe(AccessTokenActorType.User);
    expect(claims.sessionId).toBe(result.sessionId);
    expect(claims.tokenFamilyId).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(deviceSessionRepository.sessions[0].refreshTokenHash.value).toBe(
      'sha256-opaque-token-1',
    );
    expect(eventPublisher.events[0]).toBeInstanceOf(UserLoggedInEvent);
  });
});
