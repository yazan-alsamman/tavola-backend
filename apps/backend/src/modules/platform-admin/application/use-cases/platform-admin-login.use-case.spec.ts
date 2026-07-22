import { ConfigService } from '@nestjs/config';
import { PlatformAdminLoginUseCase } from './platform-admin-login.use-case';
import { InvalidPlatformAdminCredentialsException } from '../../domain/exceptions/invalid-platform-admin-credentials.exception';
import { PlatformAdminRepository } from '../../domain/repositories/platform-admin.repository';
import { JwtPlatformAdminTokenService } from '../../infrastructure/security/jwt-platform-admin-token.service';
import { RegistrationPolicy } from '@modules/authentication/domain/services/registration-policy';
import { Email } from '@shared/domain/value-objects/email.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import {
  CollectingAuditLogWriter,
  FakePasswordHasher,
  FixedClock,
  InMemoryLoginAttemptRepository,
  InMemorySystemConfiguration,
  InMemoryUserRepository,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('PlatformAdminLoginUseCase', () => {
  const fixedNow = new Date('2026-07-22T12:00:00.000Z');
  const userId = '11111111-1111-4111-8111-111111111111';
  const attemptId = '22222222-2222-4222-8222-222222222222';
  const password = 'SecurePass123!';

  class FakePlatformAdminRepository implements PlatformAdminRepository {
    constructor(private readonly activeAdminIds: Set<string>) {}
    async isActiveAdmin(id: string): Promise<boolean> {
      return this.activeAdminIds.has(id);
    }
  }

  function buildConfigService(): ConfigService {
    return {
      get: () => ({
        jwtSecret: 'platform-admin-secret-at-least-32-characters-long',
        jwtIssuer: 'tavla-platform-admin',
        jwtAudience: 'tavla-platform-admin-clients',
        jwtExpirySeconds: 900,
      }),
    } as unknown as ConfigService;
  }

  async function createAdminUser(userRepository: InMemoryUserRepository): Promise<void> {
    const user = RegistrationPolicy.createPendingUser({
      id: userId,
      email: Email.create('admin@tavla.internal'),
      passwordHash: PasswordHash.create(`argon2id$fake$${password}`),
      firstName: 'Admin',
      lastName: 'User',
      phone: null,
      language: 'en',
      at: fixedNow,
    }).verifyEmail(fixedNow);
    await userRepository.save(user);
  }

  function createUseCase(overrides?: {
    userRepository?: InMemoryUserRepository;
    platformAdminRepository?: PlatformAdminRepository;
  }) {
    const userRepository = overrides?.userRepository ?? new InMemoryUserRepository();
    const platformAdminRepository =
      overrides?.platformAdminRepository ?? new FakePlatformAdminRepository(new Set([userId]));
    const auditLogWriter = new CollectingAuditLogWriter();
    // Exercises the real signing service rather than a mock.
    const tokenService = new JwtPlatformAdminTokenService(buildConfigService());

    const useCase = new PlatformAdminLoginUseCase(
      buildConfigService(),
      userRepository,
      platformAdminRepository,
      new InMemoryLoginAttemptRepository(),
      new FakePasswordHasher(),
      tokenService,
      new FixedClock(fixedNow),
      new SequentialIdGenerator([attemptId, attemptId]),
      new InMemorySystemConfiguration(),
      auditLogWriter,
    );

    return { useCase, userRepository, auditLogWriter };
  }

  it('issues a Platform Admin access token for a valid admin', async () => {
    const userRepository = new InMemoryUserRepository();
    await createAdminUser(userRepository);
    const { useCase, auditLogWriter } = createUseCase({ userRepository });

    const result = await useCase.execute({
      email: 'admin@tavla.internal',
      password,
      ipAddress: '203.0.113.10',
    });

    expect(result.accessToken).toBeDefined();
    expect(auditLogWriter.entries.some((e) => e.action === 'platform_admin.login.success')).toBe(
      true,
    );
  });

  it('rejects a real User who is not an active Platform Admin (same error as unknown email)', async () => {
    const userRepository = new InMemoryUserRepository();
    await createAdminUser(userRepository);
    const { useCase } = createUseCase({
      userRepository,
      platformAdminRepository: new FakePlatformAdminRepository(new Set()),
    });

    await expect(
      useCase.execute({ email: 'admin@tavla.internal', password, ipAddress: '203.0.113.10' }),
    ).rejects.toThrow(InvalidPlatformAdminCredentialsException);
  });

  it('rejects an unknown email', async () => {
    const { useCase } = createUseCase();

    await expect(
      useCase.execute({ email: 'nobody@example.com', password, ipAddress: '203.0.113.10' }),
    ).rejects.toThrow(InvalidPlatformAdminCredentialsException);
  });

  it('rejects a wrong password', async () => {
    const userRepository = new InMemoryUserRepository();
    await createAdminUser(userRepository);
    const { useCase } = createUseCase({ userRepository });

    await expect(
      useCase.execute({
        email: 'admin@tavla.internal',
        password: 'WrongPassword123!',
        ipAddress: '203.0.113.10',
      }),
    ).rejects.toThrow(InvalidPlatformAdminCredentialsException);
  });
});
