import { ConfigService } from '@nestjs/config';
import { PlatformAdminLoginUseCase } from './platform-admin-login.use-case';
import { InvalidPlatformAdminCredentialsException } from '../../domain/exceptions/invalid-platform-admin-credentials.exception';
import {
  PlatformAdminAuthContext,
  PlatformAdminListPage,
  PlatformAdminRecord,
  PlatformAdminRepository,
} from '../../domain/repositories/platform-admin.repository';
import { PlatformAdminRole } from '../../domain/enums/platform-admin.enums';
import { JwtPlatformAdminTokenService } from '../../infrastructure/security/jwt-platform-admin-token.service';
import { PlatformAdminSessionIssuer } from '../services/platform-admin-session-issuer.service';
import { InMemoryPlatformAdminSessionRepository } from '../../../../../test/platform-admin/support/in-memory-platform-admin-session.repository';
import { Sha256OpaqueTokenService } from '@modules/authentication/infrastructure/security/sha256-opaque-token.service';
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
  const sessionId = '33333333-3333-4333-8333-333333333333';
  const password = 'SecurePass123!';

  class FakePlatformAdminRepository implements PlatformAdminRepository {
    constructor(private readonly activeAdminIds: Set<string>) {}
    async findActiveAdminContext(id: string): Promise<PlatformAdminAuthContext | null> {
      return this.activeAdminIds.has(id) ? { role: PlatformAdminRole.PlatformAdmin } : null;
    }
    findById(): Promise<PlatformAdminRecord | null> {
      throw new Error('Not needed by this suite.');
    }
    findByUserId(): Promise<PlatformAdminRecord | null> {
      throw new Error('Not needed by this suite.');
    }
    list(): Promise<PlatformAdminListPage> {
      throw new Error('Not needed by this suite.');
    }
    create(): Promise<void> {
      throw new Error('Not needed by this suite.');
    }
    updateRole(): Promise<void> {
      throw new Error('Not needed by this suite.');
    }
    revoke(): Promise<void> {
      throw new Error('Not needed by this suite.');
    }
    reactivate(): Promise<void> {
      throw new Error('Not needed by this suite.');
    }
  }

  function buildConfigService(): ConfigService {
    return {
      get: () => ({
        jwtSecret: 'platform-admin-secret-at-least-32-characters-long',
        jwtIssuer: 'tavla-platform-admin',
        jwtAudience: 'tavla-platform-admin-clients',
        jwtExpirySeconds: 900,
        refreshExpiryDays: 7,
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
    const sessionRepository = new InMemoryPlatformAdminSessionRepository();
    const sessionIssuer = new PlatformAdminSessionIssuer(
      buildConfigService(),
      tokenService,
      sessionRepository,
      new Sha256OpaqueTokenService(),
      new SequentialIdGenerator([sessionId, sessionId]),
    );

    const useCase = new PlatformAdminLoginUseCase(
      sessionIssuer,
      userRepository,
      platformAdminRepository,
      new InMemoryLoginAttemptRepository(),
      new FakePasswordHasher(),
      new FixedClock(fixedNow),
      new SequentialIdGenerator([attemptId, attemptId]),
      new InMemorySystemConfiguration(),
      auditLogWriter,
    );

    return { useCase, userRepository, auditLogWriter, sessionRepository };
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

  it('opens a PlatformAdminSession so refresh and logout have something to act on', async () => {
    const userRepository = new InMemoryUserRepository();
    await createAdminUser(userRepository);
    const { useCase, sessionRepository } = createUseCase({ userRepository });

    const result = await useCase.execute({
      email: 'admin@tavla.internal',
      password,
      ipAddress: '203.0.113.10',
      userAgent: 'jest',
    });

    expect(result.refreshToken).toEqual(expect.any(String));
    expect(result.tokenType).toBe('Bearer');
    expect(result.refreshTokenExpiresAt.getTime()).toBe(
      fixedNow.getTime() + 7 * 24 * 60 * 60 * 1000,
    );
    expect(sessionRepository.sessions).toHaveLength(1);

    const [session] = sessionRepository.sessions;
    expect(session.platformAdminUserId).toBe(userId);
    expect(session.isActive(fixedNow)).toBe(true);
    // Only the digest is persisted - the plaintext must not be recoverable.
    expect(session.refreshTokenHash).not.toBe(result.refreshToken);
  });

  it('does not apply the password-creation policy when verifying credentials', async () => {
    const userRepository = new InMemoryUserRepository();
    await createAdminUser(userRepository);
    const { useCase } = createUseCase({ userRepository });

    // 'short' fails every PasswordPolicy rule. It must still be reported as
    // bad credentials (401), never as a 400 validation error - otherwise the
    // response distinguishes "wrong password" from "weak-looking password".
    await expect(
      useCase.execute({
        email: 'admin@tavla.internal',
        password: 'short',
        ipAddress: '203.0.113.10',
      }),
    ).rejects.toBeInstanceOf(InvalidPlatformAdminCredentialsException);
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
