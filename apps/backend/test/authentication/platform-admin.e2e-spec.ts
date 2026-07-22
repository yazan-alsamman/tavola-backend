import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword, seedOwnerAndOrganization } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'pa_e2e_';
const PASSWORD = 'SecurePass123!';
const ORDINARY_SECRET = 'test-access-secret-at-least-32-characters-long';
const ORDINARY_ISSUER = 'tavla-api';
const ORDINARY_AUDIENCE = 'tavla-clients';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

/**
 * ADR-022 §"Platform Admin Authentication" (Phase 2.23 closure, approved
 * decision): real-HTTP proof that Platform Admin authentication is
 * genuinely isolated from the ordinary Customer/Owner/Employee JWT pipeline
 * - its own issuer/audience/secret, verified end-to-end through the real
 * `PlatformAdminGuard`, never through mocks. Forged tokens below are signed
 * directly via `jsonwebtoken` with the REAL secrets this running app
 * instance uses (read from `process.env`, never hardcoded/printed) -
 * exactly what an attacker holding a stolen ordinary token, or one who
 * guessed/leaked the Platform Admin secret's issuer/audience, would attempt.
 */
describe('Platform Admin authentication + provisioning (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let ordinaryPasswordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — platform admin e2e tests NOT EXECUTED.');
      return;
    }
    ordinaryPasswordHash = await hashTestPassword(PASSWORD);
    app = await createTestApp();
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.platformAdmin.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.deviceSession.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.tokenFamily.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.deviceSession.deleteMany({
        where: { user: { username: { startsWith: TEST_PREFIX } } },
      });
      await prisma.tokenFamily.deleteMany({
        where: { user: { username: { startsWith: TEST_PREFIX } } },
      });
      await prisma.organizationMember.deleteMany({
        where: { organization: { name: { startsWith: TEST_PREFIX } } },
      });
      await prisma.organization.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
      await prisma.user.deleteMany({ where: { username: { startsWith: TEST_PREFIX } } });
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  async function seedPlatformAdmin(suffix: string): Promise<{ userId: string; email: string }> {
    const email = `${TEST_PREFIX}${suffix}-${uniqueId()}@example.com`;
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Platform',
        lastName: 'Admin',
        email,
        passwordHash: ordinaryPasswordHash,
        language: 'en',
        status: 'Active',
        emailVerified: true,
      },
    });
    await prisma.platformAdmin.create({
      data: { id: randomUUID(), userId, revokedAt: null },
    });
    return { userId, email };
  }

  async function loginPlatformAdmin(email: string): Promise<string> {
    const response = await request(app!.getHttpServer())
      .post('/api/v1/platform-admin/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return response.body.data.accessToken as string;
  }

  function provisionPayload(suffix: string) {
    return {
      email: `${TEST_PREFIX}owner-${suffix}-${uniqueId()}@example.com`,
      password: PASSWORD,
      firstName: 'New',
      lastName: 'Owner',
      organizationName: `${TEST_PREFIX}Org ${suffix} ${uniqueId()}`,
      consents: { termsOfService: true, privacyPolicy: true },
    };
  }

  function provisionRequest(token: string, body: Record<string, unknown>) {
    return request(app!.getHttpServer())
      .post('/api/v1/platform-admin/restaurant-owners')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  // ---------------------------------------------------------------------
  // Platform Admin login
  // ---------------------------------------------------------------------

  it('authenticates a valid Platform Admin and issues a dedicated-issuer/audience token', async () => {
    if (!dbAvailable || !app) return;

    const { email } = await seedPlatformAdmin('login-ok');
    const token = await loginPlatformAdmin(email);

    expect(token).toBeDefined();
    const decoded = jwt.decode(token, { complete: true });
    expect(decoded).not.toBeNull();
    const payload = decoded!.payload as jwt.JwtPayload;
    expect(payload.iss).toBe(process.env.PLATFORM_ADMIN_JWT_ISSUER ?? 'tavla-platform-admin');
    expect(payload.aud).toBe(
      process.env.PLATFORM_ADMIN_JWT_AUDIENCE ?? 'tavla-platform-admin-clients',
    );
    // Minimal claims only - no actorType, sessionId, or permissions.
    expect(payload.sub).toBeDefined();
    expect(payload).not.toHaveProperty('actorType');
  });

  it('rejects login for a real User who is not an active Platform Admin', async () => {
    if (!dbAvailable || !app) return;

    const email = `${TEST_PREFIX}notadmin-${uniqueId()}@example.com`;
    await prisma.user.create({
      data: {
        id: randomUUID(),
        firstName: 'Not',
        lastName: 'Admin',
        email,
        passwordHash: ordinaryPasswordHash,
        language: 'en',
        status: 'Active',
        emailVerified: true,
      },
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/platform-admin/login')
      .send({ email, password: PASSWORD });
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('rejects login for an unknown email with the same generic error (no enumeration)', async () => {
    if (!dbAvailable || !app) return;

    const response = await request(app.getHttpServer())
      .post('/api/v1/platform-admin/login')
      .send({ email: `${TEST_PREFIX}unknown-${uniqueId()}@example.com`, password: PASSWORD });
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  // ---------------------------------------------------------------------
  // Restaurant Owner provisioning - happy path
  // ---------------------------------------------------------------------

  it('provisions a Restaurant Owner end-to-end: no email verification, immediately can log in', async () => {
    if (!dbAvailable || !app) return;

    const { email: adminEmail } = await seedPlatformAdmin('provision-ok');
    const token = await loginPlatformAdmin(adminEmail);
    const payload = provisionPayload('happy');

    const response = await provisionRequest(token, payload).expect(201);
    expect(response.body.data.email).toBe(payload.email);
    expect(response.body.data.organizationId).toBeDefined();
    expect(response.body.data.organizationSlug).toBeDefined();

    const user = await prisma.user.findUnique({ where: { email: payload.email } });
    expect(user).not.toBeNull();
    expect(user?.status).toBe('Active');
    expect(user?.emailVerified).toBe(true);
    expect(user?.passwordHash).not.toBe(payload.password);
    expect(user?.passwordHash.startsWith('$argon2')).toBe(true);
    expect(user?.phone).toBeNull();
    expect(user?.username).toBeNull();

    const membership = await prisma.organizationMember.findFirst({
      where: { userId: user!.id },
    });
    expect(membership?.role).toBe('Owner');

    // No email-verification artifact exists at all for this account.
    const emailVerificationTableExists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'email_verification_tokens'
      ) AS exists
    `;
    expect(emailVerificationTableExists[0].exists).toBe(false);

    // Immediately login-capable, no verification step.
    const loginResponse = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: payload.email, password: payload.password, deviceType: 'web' })
      .expect(200);
    expect(loginResponse.body.data.user.status).toBe('Active');
  });

  it('rejects provisioning a duplicate email with 409 CONFLICT', async () => {
    if (!dbAvailable || !app) return;

    const { email: adminEmail } = await seedPlatformAdmin('provision-dup-email');
    const token = await loginPlatformAdmin(adminEmail);
    const payload = provisionPayload('dupemail');

    await provisionRequest(token, payload).expect(201);
    const duplicate = await provisionRequest(token, {
      ...payload,
      organizationName: `${TEST_PREFIX}Org dupemail2 ${uniqueId()}`,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('CONFLICT');
  });

  it('rejects provisioning a duplicate organization slug with 409 CONFLICT', async () => {
    if (!dbAvailable || !app) return;

    const { email: adminEmail } = await seedPlatformAdmin('provision-dup-slug');
    const token = await loginPlatformAdmin(adminEmail);
    const sharedOrgName = `${TEST_PREFIX}Shared Org ${uniqueId()}`;
    const first = provisionPayload('slug1');
    first.organizationName = sharedOrgName;
    await provisionRequest(token, first).expect(201);

    const second = provisionPayload('slug2');
    second.organizationName = sharedOrgName;
    const response = await provisionRequest(token, second);
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('CONFLICT');
  });

  // ---------------------------------------------------------------------
  // Security isolation - the 11 frozen scenarios
  // ---------------------------------------------------------------------

  it('rejects an unauthenticated request (no Authorization header)', async () => {
    if (!dbAvailable || !app) return;

    const response = await request(app.getHttpServer())
      .post('/api/v1/platform-admin/restaurant-owners')
      .send(provisionPayload('unauth'));
    expect(response.status).toBe(403);
  });

  it('rejects a real Customer access token', async () => {
    if (!dbAvailable || !app) return;

    const username = `${TEST_PREFIX}cust${uniqueId()}`.slice(0, 20);
    let nationalDigits = '';
    for (let i = 0; i < 8; i += 1) {
      nationalDigits += Math.floor(Math.random() * 10).toString();
    }
    const phone = `+9639${nationalDigits}`;
    await prisma.user.create({
      data: {
        id: randomUUID(),
        firstName: null,
        lastName: null,
        email: null,
        username,
        phone,
        passwordHash: ordinaryPasswordHash,
        language: 'en',
        status: 'Active',
        emailVerified: false,
      },
    });
    const loginResponse = await request(app!.getHttpServer())
      .post('/api/v1/auth/customer/login')
      .send({ countryCode: 'SY', phoneNumber: `09${nationalDigits}`, password: PASSWORD })
      .expect(200);
    const customerToken = loginResponse.body.data.accessToken as string;

    const response = await provisionRequest(customerToken, provisionPayload('cust-reject'));
    expect(response.status).toBe(403);
  });

  it('rejects a real Restaurant Owner access token', async () => {
    if (!dbAvailable || !app) return;

    const email = `${TEST_PREFIX}owner-tok-${uniqueId()}@example.com`;
    await seedOwnerAndOrganization(prisma, {
      email,
      passwordHash: ordinaryPasswordHash,
      organizationName: `${TEST_PREFIX}OwnerTokenOrg ${uniqueId()}`,
    });
    const loginResponse = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, deviceType: 'web' })
      .expect(200);
    const ownerToken = loginResponse.body.data.accessToken as string;

    const response = await provisionRequest(ownerToken, provisionPayload('owner-reject'));
    expect(response.status).toBe(403);
  });

  it('rejects a forged ordinary JWT carrying actorType=Employee under the real ordinary secret/issuer/audience', async () => {
    if (!dbAvailable || !app) return;

    const forgedEmployeeToken = jwt.sign(
      {
        sub: randomUUID(),
        actorType: 'Employee',
        sessionId: randomUUID(),
        sessionVersion: 1,
        tokenFamilyId: randomUUID(),
        employeeId: randomUUID(),
        organizationId: randomUUID(),
        restaurantId: randomUUID(),
        branchIds: [],
        permissions: [],
        permissionsVersion: 1,
      },
      ORDINARY_SECRET,
      {
        algorithm: 'HS256',
        issuer: ORDINARY_ISSUER,
        audience: ORDINARY_AUDIENCE,
        expiresIn: '15m',
      },
    );

    const response = await provisionRequest(forgedEmployeeToken, provisionPayload('emp-reject'));
    expect(response.status).toBe(403);
  });

  it('rejects a forged ordinary JWT carrying actorType=PlatformAdmin under the ORDINARY issuer/audience/secret (must not bypass isolation)', async () => {
    if (!dbAvailable || !app) return;

    const forgedToken = jwt.sign(
      {
        sub: randomUUID(),
        actorType: 'PlatformAdmin',
        sessionId: randomUUID(),
        sessionVersion: 1,
        tokenFamilyId: randomUUID(),
      },
      ORDINARY_SECRET,
      {
        algorithm: 'HS256',
        issuer: ORDINARY_ISSUER,
        audience: ORDINARY_AUDIENCE,
        expiresIn: '15m',
      },
    );

    const response = await provisionRequest(forgedToken, provisionPayload('forged-actortype'));
    expect(response.status).toBe(403);
  });

  it('rejects a token signed with the real Platform Admin secret but the WRONG issuer', async () => {
    if (!dbAvailable || !app) return;

    const secret = process.env.PLATFORM_ADMIN_JWT_SECRET;
    expect(secret).toBeTruthy();
    const wrongIssuerToken = jwt.sign({ sub: randomUUID() }, secret!, {
      algorithm: 'HS256',
      issuer: 'not-the-real-issuer',
      audience: process.env.PLATFORM_ADMIN_JWT_AUDIENCE ?? 'tavla-platform-admin-clients',
      expiresIn: '15m',
    });

    const response = await provisionRequest(wrongIssuerToken, provisionPayload('wrong-issuer'));
    expect(response.status).toBe(403);
  });

  it('rejects a token signed with the real Platform Admin secret but the WRONG audience', async () => {
    if (!dbAvailable || !app) return;

    const secret = process.env.PLATFORM_ADMIN_JWT_SECRET;
    expect(secret).toBeTruthy();
    const wrongAudienceToken = jwt.sign({ sub: randomUUID() }, secret!, {
      algorithm: 'HS256',
      issuer: process.env.PLATFORM_ADMIN_JWT_ISSUER ?? 'tavla-platform-admin',
      audience: 'not-the-real-audience',
      expiresIn: '15m',
    });

    const response = await provisionRequest(wrongAudienceToken, provisionPayload('wrong-aud'));
    expect(response.status).toBe(403);
  });

  it('rejects an expired Platform Admin token', async () => {
    if (!dbAvailable || !app) return;

    const secret = process.env.PLATFORM_ADMIN_JWT_SECRET;
    expect(secret).toBeTruthy();
    const { userId } = await seedPlatformAdmin('expired');
    const expiredToken = jwt.sign({ sub: userId }, secret!, {
      algorithm: 'HS256',
      issuer: process.env.PLATFORM_ADMIN_JWT_ISSUER ?? 'tavla-platform-admin',
      audience: process.env.PLATFORM_ADMIN_JWT_AUDIENCE ?? 'tavla-platform-admin-clients',
      expiresIn: -10,
    });

    const response = await provisionRequest(expiredToken, provisionPayload('expired'));
    expect(response.status).toBe(403);
  });

  it('rejects a well-formed Platform Admin token for a nonexistent user (sub not found)', async () => {
    if (!dbAvailable || !app) return;

    const secret = process.env.PLATFORM_ADMIN_JWT_SECRET;
    expect(secret).toBeTruthy();
    const nonexistentToken = jwt.sign({ sub: randomUUID() }, secret!, {
      algorithm: 'HS256',
      issuer: process.env.PLATFORM_ADMIN_JWT_ISSUER ?? 'tavla-platform-admin',
      audience: process.env.PLATFORM_ADMIN_JWT_AUDIENCE ?? 'tavla-platform-admin-clients',
      expiresIn: '15m',
    });

    const response = await provisionRequest(nonexistentToken, provisionPayload('nonexistent'));
    expect(response.status).toBe(403);
  });

  it('rejects a valid token for a Platform Admin that has since been revoked', async () => {
    if (!dbAvailable || !app) return;

    const { userId, email } = await seedPlatformAdmin('revoke');
    const token = await loginPlatformAdmin(email);

    // Confirm it works before revocation.
    await provisionRequest(token, provisionPayload('revoke-before')).expect(201);

    await prisma.platformAdmin.updateMany({
      where: { userId },
      data: { revokedAt: new Date() },
    });

    const response = await provisionRequest(token, provisionPayload('revoke-after'));
    expect(response.status).toBe(403);
  });
});
