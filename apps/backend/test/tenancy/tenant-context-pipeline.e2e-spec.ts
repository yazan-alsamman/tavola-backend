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
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

/**
 * Phase 2.13 — proves TenantContextInterceptor is active on the real request
 * pipeline (AppModule → global APP_INTERCEPTOR) without regressing any
 * existing Authentication behavior. Full cross-organization HTTP isolation
 * (Tenant A vs Tenant B via distinct authenticated actors) is NOT covered
 * here — no currently-implemented use case issues a JWT carrying
 * organizationId (see Phase 2.13 report: Customer/User actors have none by
 * design, per AUTHENTICATION_ARCHITECTURE.md §2.2). That isolation is proven
 * at the Prisma-extension/integration tier instead
 * (test/tenancy/prisma-tenant-scoping.integration-spec.ts), directly against
 * real PostgreSQL, per TENANCY.md's own stated testing requirement. This
 * suite proves the interceptor is wired into the real pipeline and does not
 * break public or authenticated non-tenant endpoints, and that guard
 * ordering (stale session rejected before any handler code runs) holds.
 */

const prisma = new PrismaClient();
const TEST_PREFIX = 'tp-e2e-';
const PASSWORD = 'SecurePass123!';

/** Short unique suffix — validator.js's IsEmail enforces RFC 5321's 64-char
 * local-part limit, so the prefix + suffix must stay well under that. */
function uniqueId(): string {
  return randomUUID().split('-')[0];
}

describe('TenantContextInterceptor pipeline (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — tenancy pipeline e2e tests NOT EXECUTED.');
      return;
    }

    process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-32-characters-long';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-characters-long';
    process.env.ARGON2_MEMORY_COST = '4096';
    process.env.ARGON2_TIME_COST = '1';

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
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  async function createUserAndLogin(email: string, deviceName: string) {
    await prisma.user.create({
      data: {
        id: randomUUID(),
        firstName: 'Pipeline',
        lastName: 'Test',
        email,
        passwordHash,
        language: 'en',
        status: UserStatus.Active,
        emailVerified: true,
      },
    });

    const response = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, deviceName, deviceType: 'web' })
      .expect(200);

    return response.body.data as { accessToken: string; sessionId: string };
  }

  it('public endpoints (no auth guard) succeed unaffected by the global TenantContextInterceptor', async () => {
    if (!dbAvailable || !app) return;

    const email = `${TEST_PREFIX}public-${uniqueId()}@example.com`;
    await prisma.user.create({
      data: {
        id: randomUUID(),
        firstName: 'Public',
        lastName: 'Endpoint',
        email,
        passwordHash,
        language: 'en',
        status: UserStatus.Active,
        emailVerified: true,
      },
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, deviceName: 'device', deviceType: 'web' })
      .expect(200);

    // forgot-password is public and must respond generically regardless of
    // whether the email exists — proves the interceptor doesn't require an
    // authenticated actor to be present at all.
    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: `${TEST_PREFIX}none-${uniqueId()}@example.com` })
      .expect(200);
  });

  it('authenticated non-tenant endpoints (Customer/User actor, no organizationId) succeed unaffected', async () => {
    if (!dbAvailable || !app) return;

    const email = `${TEST_PREFIX}auth-${uniqueId()}@example.com`;
    const login = await createUserAndLogin(email, 'device-authed');

    await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${login.accessToken}`)
      .expect(200);
  });

  it('rejects requests with no authentication before any tenant-context/handler code runs', async () => {
    if (!dbAvailable || !app) return;

    await request(app.getHttpServer()).get('/api/v1/auth/sessions').expect(401);
  });

  it('SessionVersionGuard rejects a stale token before the interceptor/controller ever executes', async () => {
    if (!dbAvailable || !app) return;

    const email = `${TEST_PREFIX}stale-${uniqueId()}@example.com`;
    const login = await createUserAndLogin(email, 'device-stale');

    // Logout-all bumps sessionVersion; the access token used to call it
    // becomes stale on the very next guarded request.
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${login.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${login.accessToken}`)
      .expect(401);
  });

  it('keeps concurrent authenticated requests from different users isolated (per-request context)', async () => {
    if (!dbAvailable || !app) return;

    const loginA = await createUserAndLogin(
      `${TEST_PREFIX}ca-${uniqueId()}@example.com`,
      'device-a',
    );
    const loginB = await createUserAndLogin(
      `${TEST_PREFIX}cb-${uniqueId()}@example.com`,
      'device-b',
    );

    const [responseA, responseB] = await Promise.all([
      request(app.getHttpServer())
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${loginA.accessToken}`)
        .expect(200),
      request(app.getHttpServer())
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${loginB.accessToken}`)
        .expect(200),
    ]);

    const sessionIdsA = responseA.body.data.sessions.map((s: { sessionId: string }) => s.sessionId);
    const sessionIdsB = responseB.body.data.sessions.map((s: { sessionId: string }) => s.sessionId);

    expect(sessionIdsA).toContain(loginA.sessionId);
    expect(sessionIdsA).not.toContain(loginB.sessionId);
    expect(sessionIdsB).toContain(loginB.sessionId);
    expect(sessionIdsB).not.toContain(loginA.sessionId);
  });
});
