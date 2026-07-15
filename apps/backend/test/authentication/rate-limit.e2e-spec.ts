import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, UserStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { createTestApp } from '../helpers/test-app.factory';
import { Argon2PasswordHasher } from '@modules/authentication/infrastructure/security/argon2-password-hasher';
import { Password } from '@shared/domain/value-objects/password.vo';
import authConfig from '@config/auth.config';
import {
  isDatabaseReachable,
  isRedisReachable,
  resolveTestRedisUrl,
  skipUnlessDatabaseAvailable,
} from '../support/live-database';

jest.setTimeout(20_000);

const prisma = new PrismaClient();

// Small, fast-testable overrides for THIS file's own isolated app instance
// only. jest-e2e.setup.ts's generous defaults (1000) protect every other
// e2e spec file sharing this worker's real loopback IP from tripping the
// production-accurate limits; restored (not deleted - see below) in
// afterAll so later files in the same worker keep seeing the generous
// baseline rather than falling back to the strict production defaults.
const OVERRIDES: Record<string, string> = {
  RATE_LIMIT_LOGIN_MAX: '3',
  RATE_LIMIT_LOGIN_WINDOW_SECONDS: '2',
  RATE_LIMIT_FORGOT_PASSWORD_MAX: '3',
  RATE_LIMIT_FORGOT_PASSWORD_WINDOW_SECONDS: '3600',
  RATE_LIMIT_RESET_PASSWORD_MAX: '3',
  RATE_LIMIT_RESET_PASSWORD_WINDOW_SECONDS: '3600',
  RATE_LIMIT_REFRESH_MAX: '3',
  RATE_LIMIT_REFRESH_WINDOW_SECONDS: '3600',
  RATE_LIMIT_CHANGE_PASSWORD_MAX: '3',
  RATE_LIMIT_CHANGE_PASSWORD_WINDOW_SECONDS: '3600',
};

const RESTORE: Record<string, string> = {
  RATE_LIMIT_LOGIN_MAX: '1000',
  RATE_LIMIT_FORGOT_PASSWORD_MAX: '1000',
  RATE_LIMIT_RESET_PASSWORD_MAX: '1000',
  RATE_LIMIT_REFRESH_MAX: '1000',
  RATE_LIMIT_CHANGE_PASSWORD_MAX: '1000',
};

// Kept short: the local-part of the generated email (prefix + suffix +
// UUID) must stay under RFC 5321's 64-character limit, which @IsEmail()
// enforces - a longer prefix here previously pushed the total past 64 and
// caused every login in this file's helper to fail with a spurious 400
// VALIDATION_ERROR ("email must be an email") rather than the intended
// rate-limit assertions.
const CHANGE_PASSWORD_TEST_PREFIX = 'rl-chpw-';
const CHANGE_PASSWORD_CURRENT = 'SecurePass123!';

describe('Redis-backed auth rate limiting (e2e)', () => {
  let app: INestApplication | undefined;
  let app2: INestApplication | undefined;
  let ready = false;
  let changePasswordHash = 'argon2id$test';

  beforeAll(async () => {
    const dbAvailable = await isDatabaseReachable();
    const redisAvailable = await isRedisReachable(resolveTestRedisUrl());
    ready = dbAvailable && redisAvailable;

    if (skipUnlessDatabaseAvailable(ready)) {
      console.warn(
        'PostgreSQL and/or Redis not reachable — rate-limit e2e tests NOT EXECUTED. Start Docker stack per ENVIRONMENT_SETUP.md.',
      );
      return;
    }

    process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-32-characters-long';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-characters-long';
    process.env.ARGON2_MEMORY_COST = '4096';
    process.env.ARGON2_TIME_COST = '1';

    for (const [key, value] of Object.entries(OVERRIDES)) {
      process.env[key] = value;
    }

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, load: [authConfig] })],
      providers: [Argon2PasswordHasher],
    }).compile();
    const hasher = moduleRef.get(Argon2PasswordHasher);
    changePasswordHash = (await hasher.hash(Password.create(CHANGE_PASSWORD_CURRENT))).value;

    app = await createTestApp();
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(RESTORE)) {
      process.env[key] = value;
    }
    if (ready) {
      await prisma.deviceSession.deleteMany({
        where: { user: { email: { startsWith: CHANGE_PASSWORD_TEST_PREFIX } } },
      });
      await prisma.tokenFamily.deleteMany({
        where: { user: { email: { startsWith: CHANGE_PASSWORD_TEST_PREFIX } } },
      });
      await prisma.passwordHistory.deleteMany({
        where: { user: { email: { startsWith: CHANGE_PASSWORD_TEST_PREFIX } } },
      });
      await prisma.user.deleteMany({
        where: { email: { startsWith: CHANGE_PASSWORD_TEST_PREFIX } },
      });
    }
    if (app) await app.close();
    if (app2) await app2.close();
    await prisma.$disconnect();
  });

  function fakeIp(): string {
    return `test-ip-${randomUUID()}`;
  }

  it('allows up to the configured max login attempts per IP, then blocks with 429', async () => {
    if (!ready || !app) return;

    const ip = fakeIp();
    for (let i = 0; i < 3; i += 1) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: 'rate-limit-nobody@example.com', password: 'WrongPass123!' });
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('AUTH_INVALID_CREDENTIALS');
    }

    const blocked = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: 'rate-limit-nobody@example.com', password: 'WrongPass123!' });

    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(blocked.body.success).toBe(false);
  });

  it('keeps each IP bucket independent - a different IP is unaffected', async () => {
    if (!ready || !app) return;

    const exhaustedIp = fakeIp();
    for (let i = 0; i < 3; i += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', exhaustedIp)
        .send({ email: 'rate-limit-nobody@example.com', password: 'WrongPass123!' });
    }
    const blocked = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', exhaustedIp)
      .send({ email: 'rate-limit-nobody@example.com', password: 'WrongPass123!' });
    expect(blocked.status).toBe(429);

    const freshIp = fakeIp();
    const allowed = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', freshIp)
      .send({ email: 'rate-limit-nobody@example.com', password: 'WrongPass123!' });
    expect(allowed.status).toBe(401);
    expect(allowed.body.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('resets the window after it fully expires (real 2s window)', async () => {
    if (!ready || !app) return;

    const ip = fakeIp();
    for (let i = 0; i < 3; i += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: 'rate-limit-nobody@example.com', password: 'WrongPass123!' });
    }
    const blocked = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: 'rate-limit-nobody@example.com', password: 'WrongPass123!' });
    expect(blocked.status).toBe(429);

    await new Promise((resolve) => setTimeout(resolve, 2_100));

    const allowedAgain = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: 'rate-limit-nobody@example.com', password: 'WrongPass123!' });
    expect(allowedAgain.status).toBe(401);
    expect(allowedAgain.body.code).toBe('AUTH_INVALID_CREDENTIALS');
  }, 10_000);

  it('caps a concurrent burst at exactly the configured limit (no race condition)', async () => {
    if (!ready || !app) return;

    const ip = fakeIp();
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app!.getHttpServer())
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', ip)
          .send({ email: 'rate-limit-nobody@example.com', password: 'WrongPass123!' }),
      ),
    );

    const blockedCount = responses.filter((response) => response.status === 429).length;
    const passedThroughCount = responses.filter((response) => response.status === 401).length;
    expect(passedThroughCount).toBe(3);
    expect(blockedCount).toBe(7);
  });

  it('keys forgot-password by email, independent of IP', async () => {
    if (!ready || !app) return;

    const email = `rate-limit-forgot-${randomUUID()}@example.com`;
    for (let i = 0; i < 3; i += 1) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email });
      expect(response.status).toBe(200);
    }

    const blocked = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email });
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMIT_EXCEEDED');

    const otherEmail = `rate-limit-forgot-other-${randomUUID()}@example.com`;
    const allowed = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: otherEmail });
    expect(allowed.status).toBe(200);
  });

  it('keys reset-password by IP', async () => {
    if (!ready || !app) return;

    const ip = fakeIp();
    for (let i = 0; i < 3; i += 1) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .set('X-Forwarded-For', ip)
        .send({ token: 'nonexistent-reset-token', newPassword: 'ValidPass123!' });
      expect(response.status).toBe(401);
    }

    const blocked = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .set('X-Forwarded-For', ip)
      .send({ token: 'nonexistent-reset-token', newPassword: 'ValidPass123!' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('keys refresh by the presented refresh token, not by IP', async () => {
    if (!ready || !app) return;

    const sharedIp = fakeIp();
    const tokenA = `fake-refresh-token-${randomUUID()}`;
    const tokenB = `fake-refresh-token-${randomUUID()}`;

    for (let i = 0; i < 3; i += 1) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('X-Forwarded-For', sharedIp)
        .send({ refreshToken: tokenA });
      expect(response.status).toBe(401);
    }
    const blockedA = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('X-Forwarded-For', sharedIp)
      .send({ refreshToken: tokenA });
    expect(blockedA.status).toBe(429);

    // Different token, same IP: unaffected, proving the key is the token, not the IP.
    const allowedB = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('X-Forwarded-For', sharedIp)
      .send({ refreshToken: tokenB });
    expect(allowedB.status).toBe(401);
  });

  it('enforces the limit across multiple application instances sharing Redis (horizontal scaling)', async () => {
    if (!ready) return;

    app2 = await createTestApp();
    const ip = fakeIp();

    for (let i = 0; i < 3; i += 1) {
      const response = await request(app!.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: 'rate-limit-nobody@example.com', password: 'WrongPass123!' });
      expect(response.status).toBe(401);
    }

    // Same IP, second independent Nest application instance: state lives in
    // Redis, not per-process memory, so this must already be blocked.
    const blockedOnSecondInstance = await request(app2.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: 'rate-limit-nobody@example.com', password: 'WrongPass123!' });

    expect(blockedOnSecondInstance.status).toBe(429);
  });

  async function createAndLoginUser(emailSuffix: string): Promise<string> {
    const email = `${CHANGE_PASSWORD_TEST_PREFIX}${emailSuffix}-${randomUUID()}@example.com`;
    await prisma.user.create({
      data: {
        id: randomUUID(),
        firstName: 'Rate',
        lastName: 'Limit',
        email,
        passwordHash: changePasswordHash,
        language: 'en',
        status: UserStatus.Active,
        emailVerified: true,
      },
    });
    // A fresh, unique X-Forwarded-For per call is required here (unlike the
    // real user-facing login flow) so this helper's own login request never
    // lands in the shared real-loopback-IP bucket that any other e2e file
    // (or a previous run) may already have touched - without it, this test's
    // pass/fail depended on exactly how many other no-header logins happened
    // earlier in the same worker, which is the root cause of the
    // order-dependent flake this file used to have.
    const response = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', fakeIp())
      .send({ email, password: CHANGE_PASSWORD_CURRENT, deviceType: 'web' })
      .expect(200);
    return response.body.data.accessToken as string;
  }

  // Regression test for a Phase 2.22 security-audit finding: change-password
  // previously had no rate limit at all, so a holder of a valid access token
  // (e.g. stolen via XSS) could brute-force the real password with unlimited
  // wrong-currentPassword guesses. Now reuses the same RateLimitGuard
  // mechanism as every other sensitive auth endpoint, keyed by userId.
  it('rate limits change-password by authenticated userId, then blocks with 429', async () => {
    if (!ready || !app) return;

    const accessToken = await createAndLoginUser('blocked');

    for (let i = 0; i < 3; i += 1) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ currentPassword: 'WrongPass123!', newPassword: 'BrandNewPass1!' });
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('AUTH_INVALID_CREDENTIALS');
    }

    const blocked = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'WrongPass123!', newPassword: 'BrandNewPass1!' });

    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it("keeps each authenticated user's change-password bucket independent", async () => {
    if (!ready || !app) return;

    const exhaustedToken = await createAndLoginUser('exhausted');
    for (let i = 0; i < 3; i += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${exhaustedToken}`)
        .send({ currentPassword: 'WrongPass123!', newPassword: 'BrandNewPass1!' });
    }
    const blocked = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${exhaustedToken}`)
      .send({ currentPassword: 'WrongPass123!', newPassword: 'BrandNewPass1!' });
    expect(blocked.status).toBe(429);

    const freshToken = await createAndLoginUser('fresh');
    const allowed = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${freshToken}`)
      .send({ currentPassword: 'WrongPass123!', newPassword: 'BrandNewPass1!' });
    expect(allowed.status).toBe(401);
    expect(allowed.body.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('leaves endpoints without a @RateLimit policy unrestricted', async () => {
    if (!ready || !app) return;

    for (let i = 0; i < 5; i += 1) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .send({ token: 'nonexistent-verification-token' });
      expect(response.status).not.toBe(429);
    }
  });
});
