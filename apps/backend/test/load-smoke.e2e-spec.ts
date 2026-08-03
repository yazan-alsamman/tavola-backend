import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, UserStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { createTestApp } from './helpers/test-app.factory';
import { Argon2PasswordHasher } from '@modules/authentication/infrastructure/security/argon2-password-hasher';
import { Password } from '@shared/domain/value-objects/password.vo';
import authConfig from '@config/auth.config';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from './support/live-database';

/**
 * Phase 2.22's "load smoke" deliverable (TASKS.md). Deliberately NOT a Load
 * Test in TESTING_STRATEGY.md's sense (throughput/response-time validation
 * against NON_FUNCTIONAL_REQUIREMENTS.md's SLO numbers via k6/Artillery,
 * explicitly deferred to "ahead of Phase 15" and run against staging, not
 * CI) - this is the "Smoke tests" NON_FUNCTIONAL_REQUIREMENTS.md's
 * Deployment Requirements section separately requires for every deployment:
 * a concurrent burst against the real running application (real Postgres,
 * real Redis, no mocks) asserting the app stays up, produces no 5xx/crash,
 * handles concurrent writes correctly, and remains healthy afterward. No
 * response-time thresholds are asserted here - those belong to the
 * staging-tier Load Tests this deliberately does not attempt to replace.
 */
const prisma = new PrismaClient();
const TEST_PREFIX = 'load-smoke-';
const PASSWORD = 'SecurePass123!';

describe('Load smoke (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — load smoke tests NOT EXECUTED.');
      return;
    }

    process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-32-characters-long';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-characters-long';
    process.env.ARGON2_MEMORY_COST = '4096';
    process.env.ARGON2_TIME_COST = '1';
    // A concurrent burst from one loopback IP must not be mistaken for abuse
    // by the very rate limiter this smoke test is also implicitly exercising.
    // Raised from 1000 (2026-07-29, Phase 15.5 verification session): the
    // login rate limit key is shared (per-IP, real Redis) across the entire
    // e2e run, not just this file - at 465 tests across 41 files, the rest
    // of the suite's own real logins can already consume a large share of a
    // too-tight budget before this smoke test's own burst runs.
    process.env.RATE_LIMIT_LOGIN_MAX = '10000';

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, load: [authConfig] })],
      providers: [Argon2PasswordHasher],
    }).compile();
    const hasher = moduleRef.get(Argon2PasswordHasher);
    passwordHash = (await hasher.hash(Password.create(PASSWORD))).value;

    app = await createTestApp();
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.deviceSession.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.tokenFamily.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
      await prisma.organizationMember.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.organization.deleteMany({
        where: { slug: { startsWith: TEST_PREFIX } },
      });
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  }, 30_000);

  it('survives a concurrent burst of health checks with no failures', async () => {
    if (!dbAvailable || !app) return;

    const BURST_SIZE = 50;
    const responses = await Promise.all(
      Array.from({ length: BURST_SIZE }, () => request(app!.getHttpServer()).get('/api/v1/health')),
    );

    expect(responses).toHaveLength(BURST_SIZE);
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
    }
  }, 30_000);

  it('handles a concurrent burst of logins against distinct accounts with no 5xx and no cross-account bleed', async () => {
    if (!dbAvailable || !app) return;

    const BURST_SIZE = 25;
    const emails = Array.from(
      { length: BURST_SIZE },
      (_, i) => `${TEST_PREFIX}login-${i}-${randomUUID()}@example.com`,
    );

    await Promise.all(
      emails.map((email) =>
        prisma.user.create({
          data: {
            id: randomUUID(),
            firstName: 'Load',
            lastName: 'Smoke',
            email,
            passwordHash,
            language: 'en',
            status: UserStatus.Active,
            emailVerified: true,
          },
        }),
      ),
    );

    const responses = await Promise.all(
      emails.map((email) =>
        request(app!.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email, password: PASSWORD, deviceType: 'web' }),
      ),
    );

    expect(responses).toHaveLength(BURST_SIZE);
    const returnedEmails = new Set<string>();
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.body.data.user.email).toBeTruthy();
      // Each concurrent login must resolve to its own account, never
      // another concurrently-processed request's session/user data.
      expect(returnedEmails.has(response.body.data.user.email)).toBe(false);
      returnedEmails.add(response.body.data.user.email);
    }
    expect(returnedEmails.size).toBe(BURST_SIZE);

    const sessionCount = await prisma.deviceSession.count({
      where: { user: { email: { startsWith: `${TEST_PREFIX}login-` } } },
    });
    expect(sessionCount).toBe(BURST_SIZE);
  }, 30_000);

  // ADR-022 (Phase 2.23): the former "concurrent registration burst" smoke
  // test exercised the now-retired public `/auth/register` (Owner
  // self-registration). Restaurant Owners are provisioned exclusively via
  // `POST /platform-admin/restaurant-owners` now; a concurrent-burst
  // equivalent for that route belongs in the Platform Admin E2E suite (still
  // pending — it needs its own OTP-provider-free, Platform-Admin-authenticated
  // fixture, which this generic load-smoke file deliberately does not set
  // up), not a mechanical substitution here.

  it('remains healthy and responsive immediately after the concurrent bursts above', async () => {
    if (!dbAvailable || !app) return;

    const response = await request(app.getHttpServer()).get('/api/v1/health/readiness');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });
});
