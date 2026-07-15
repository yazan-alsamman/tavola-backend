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
    process.env.RATE_LIMIT_LOGIN_MAX = '1000';
    process.env.RATE_LIMIT_REGISTER_MAX = '1000';

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

  it('handles a concurrent registration burst with unique emails and no duplicate/orphaned rows', async () => {
    if (!dbAvailable || !app) return;

    const BURST_SIZE = 15;
    const requests = Array.from({ length: BURST_SIZE }, (_, i) => ({
      intent: 'owner' as const,
      email: `${TEST_PREFIX}register-${i}-${randomUUID()}@example.com`,
      password: 'AnotherSecurePass1!',
      firstName: 'Load',
      lastName: 'Smoke',
      organizationName: `${TEST_PREFIX}org-${i}-${randomUUID()}`,
      consents: { termsOfService: true, privacyPolicy: true },
    }));

    const responses = await Promise.all(
      requests.map((body) =>
        request(app!.getHttpServer()).post('/api/v1/auth/register').send(body),
      ),
    );

    expect(responses).toHaveLength(BURST_SIZE);
    const userIds = new Set<string>();
    for (const response of responses) {
      expect(response.status).toBe(201);
      expect(userIds.has(response.body.data.userId)).toBe(false);
      userIds.add(response.body.data.userId);
    }
    expect(userIds.size).toBe(BURST_SIZE);

    const createdUsers = await prisma.user.count({
      where: { email: { startsWith: `${TEST_PREFIX}register-` } },
    });
    const createdMemberships = await prisma.organizationMember.count({
      where: { user: { email: { startsWith: `${TEST_PREFIX}register-` } } },
    });
    expect(createdUsers).toBe(BURST_SIZE);
    expect(createdMemberships).toBe(BURST_SIZE);
  }, 30_000);

  it('remains healthy and responsive immediately after the concurrent bursts above', async () => {
    if (!dbAvailable || !app) return;

    const response = await request(app.getHttpServer()).get('/api/v1/health/readiness');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });
});
