import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, UserStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import authConfig from '@config/auth.config';
import { createTestApp } from '../helpers/test-app.factory';
import { Argon2PasswordHasher } from '@modules/authentication/infrastructure/security/argon2-password-hasher';
import { Password } from '@shared/domain/value-objects/password.vo';
import { PermissionGuardFixtureModule } from './support/permission-guard-fixture.module';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'pguard-e2e-';
const TEST_PASSWORD = 'SecurePass123!';
const ACCESS_SECRET = 'test-access-secret-at-least-32-characters-long';

describe('PermissionsGuard / @RequirePermission (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn(
        'PostgreSQL not reachable — skipping PermissionsGuard e2e tests. Start Docker stack per ENVIRONMENT_SETUP.md.',
      );
      return;
    }

    process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-characters-long';
    process.env.ARGON2_MEMORY_COST = '4096';
    process.env.ARGON2_TIME_COST = '1';

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, load: [authConfig] })],
      providers: [Argon2PasswordHasher],
    }).compile();
    const hasher = moduleRef.get(Argon2PasswordHasher);
    passwordHash = (await hasher.hash(Password.create(TEST_PASSWORD))).value;

    app = await createTestApp([PermissionGuardFixtureModule]);
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.rolePermission.deleteMany({
        where: {
          OR: [
            { role: { slug: { startsWith: TEST_PREFIX } } },
            { employee: { email: { startsWith: TEST_PREFIX } } },
          ],
        },
      });
      await prisma.employee.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
      await prisma.role.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
      await prisma.permission.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
      await prisma.restaurant.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
      await prisma.organizationMember.deleteMany({
        where: { organization: { slug: { startsWith: TEST_PREFIX } } },
      });
      await prisma.organization.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
      await prisma.deviceSession.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.tokenFamily.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.loginAttempt.deleteMany({ where: { identifier: { startsWith: TEST_PREFIX } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  async function seedUser(suffix: string) {
    // Keep the local-part well under the 64-char RFC limit enforced by
    // class-validator's @IsEmail - the prefix + full test name + a full UUID
    // would otherwise silently fail login with a generic validation error.
    const email = `${TEST_PREFIX}${suffix}-${randomUUID().slice(0, 8)}@example.com`;
    const user = await prisma.user.create({
      data: {
        firstName: 'Guard',
        lastName: 'E2E',
        email,
        passwordHash,
        language: 'en',
        status: UserStatus.Active,
        emailVerified: true,
      },
    });
    return { email, user };
  }

  /** Seeds an Organization + Restaurant + Role + grants/revocations + a linked, Active Employee. */
  async function seedEmployee(input: {
    userId: string;
    roleGrantSlugs: string[];
    individualGrantSlugs?: string[];
    individualRevocationSlugs?: string[];
  }) {
    const organization = await prisma.organization.create({
      data: {
        name: 'Guard E2E Org',
        slug: `${TEST_PREFIX}org-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}billing-${randomUUID()}@example.com`,
      },
    });
    const restaurant = await prisma.restaurant.create({
      data: {
        organizationId: organization.id,
        name: 'Guard E2E Restaurant',
        slug: `${TEST_PREFIX}restaurant-${randomUUID()}`,
        status: 'Active',
      },
    });
    const role = await prisma.role.create({
      data: {
        name: `${TEST_PREFIX}Role-${randomUUID()}`,
        slug: `${TEST_PREFIX}role-${randomUUID()}`,
        description: 'Guard e2e role',
        scope: 'Restaurant',
      },
    });
    const employee = await prisma.employee.create({
      data: {
        restaurantId: restaurant.id,
        roleId: role.id,
        userId: input.userId,
        firstName: 'Guard',
        lastName: 'Employee',
        email: `${TEST_PREFIX}employee-${randomUUID()}@example.com`,
        status: 'Active',
      },
    });

    const allSlugs = new Set([
      ...input.roleGrantSlugs,
      ...(input.individualGrantSlugs ?? []),
      ...(input.individualRevocationSlugs ?? []),
    ]);
    const permissionIds = new Map<string, string>();
    for (const slug of allSlugs) {
      const permission = await prisma.permission.upsert({
        where: { slug },
        create: { slug, description: 'Guard e2e permission' },
        update: {},
      });
      permissionIds.set(slug, permission.id);
    }

    for (const slug of input.roleGrantSlugs) {
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: permissionIds.get(slug)!, type: 'RoleGrant' },
      });
    }
    for (const slug of input.individualGrantSlugs ?? []) {
      await prisma.rolePermission.create({
        data: {
          employeeId: employee.id,
          permissionId: permissionIds.get(slug)!,
          type: 'IndividualGrant',
        },
      });
    }
    for (const slug of input.individualRevocationSlugs ?? []) {
      await prisma.rolePermission.create({
        data: {
          employeeId: employee.id,
          permissionId: permissionIds.get(slug)!,
          type: 'IndividualRevocation',
        },
      });
    }

    return { organization, restaurant, role, employee };
  }

  async function login(email: string) {
    const response = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    return response.body.data as {
      accessToken: string;
      refreshToken: string;
    };
  }

  it('rejects requests with no Authorization header', async () => {
    if (!dbAvailable || !app) return;

    const response = await request(app.getHttpServer())
      .get('/api/v1/test/permissions/reservations-approve')
      .expect(401);
    expect(response.body.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('rejects an invalid/malformed access token', async () => {
    if (!dbAvailable || !app) return;

    await request(app.getHttpServer())
      .get('/api/v1/test/permissions/reservations-approve')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);
  });

  it('rejects an expired access token', async () => {
    if (!dbAvailable || !app) return;

    const expiredToken = jwt.sign(
      {
        sub: randomUUID(),
        actorType: 'User',
        sessionId: randomUUID(),
        sessionVersion: 1,
        tokenFamilyId: randomUUID(),
      },
      ACCESS_SECRET,
      {
        algorithm: 'HS256',
        issuer: 'tavla-api',
        audience: 'tavla-clients',
        expiresIn: -10,
        keyid: 'current',
      },
    );

    const response = await request(app.getHttpServer())
      .get('/api/v1/test/permissions/reservations-approve')
      .set('Authorization', `Bearer ${expiredToken}`)
      .expect(401);
    expect(response.body.code).toBe('AUTH_EXPIRED_TOKEN');
  });

  it('allows an Employee with a role grant to access the exact-matching permission route', async () => {
    if (!dbAvailable || !app) return;

    const { email, user } = await seedUser('role-grant');
    await seedEmployee({ userId: user.id, roleGrantSlugs: ['reservations:approve'] });
    const { accessToken } = await login(email);

    const response = await request(app.getHttpServer())
      .get('/api/v1/test/permissions/reservations-approve')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(response.body.data).toEqual({ ok: true, actorType: 'Employee' });
  });

  it('denies an Employee without the required permission (unrelated permission held)', async () => {
    if (!dbAvailable || !app) return;

    const { email, user } = await seedUser('unrelated-permission');
    await seedEmployee({ userId: user.id, roleGrantSlugs: ['tables:manage'] });
    const { accessToken } = await login(email);

    const response = await request(app.getHttpServer())
      .get('/api/v1/test/permissions/reservations-approve')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('allows an Employee via an individual grant not present on the role', async () => {
    if (!dbAvailable || !app) return;

    const { email, user } = await seedUser('individual-grant');
    await seedEmployee({
      userId: user.id,
      roleGrantSlugs: ['tables:manage'],
      individualGrantSlugs: ['reservations:approve'],
    });
    const { accessToken } = await login(email);

    await request(app.getHttpServer())
      .get('/api/v1/test/permissions/reservations-approve')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });

  it('denies when an individual revocation overrides a role grant', async () => {
    if (!dbAvailable || !app) return;

    const { email, user } = await seedUser('individual-revocation');
    await seedEmployee({
      userId: user.id,
      roleGrantSlugs: ['reservations:approve'],
      individualRevocationSlugs: ['reservations:approve'],
    });
    const { accessToken } = await login(email);

    const response = await request(app.getHttpServer())
      .get('/api/v1/test/permissions/reservations-approve')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('denies a plain Customer/User actor - no employee RBAC permissions exist for them', async () => {
    if (!dbAvailable || !app) return;

    const { email } = await seedUser('customer');
    const { accessToken } = await login(email);

    const authOnly = await request(app.getHttpServer())
      .get('/api/v1/test/permissions/authenticated-only')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(authOnly.body.data.actorType).toBe('User');

    await request(app.getHttpServer())
      .get('/api/v1/test/permissions/reservations-approve')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
  });

  it('denies an OrganizationMember actor - org role is a separate authority layer from Employee RBAC', async () => {
    if (!dbAvailable || !app) return;

    const { email, user } = await seedUser('org-member');
    const organization = await prisma.organization.create({
      data: {
        name: 'Guard E2E OrgMember Org',
        slug: `${TEST_PREFIX}org-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}billing-${randomUUID()}@example.com`,
      },
    });
    await prisma.organizationMember.create({
      data: { organizationId: organization.id, userId: user.id, role: 'Owner', status: 'Active' },
    });
    const { accessToken } = await login(email);

    const authOnly = await request(app.getHttpServer())
      .get('/api/v1/test/permissions/authenticated-only')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(authOnly.body.data.actorType).toBe('OrganizationMember');

    await request(app.getHttpServer())
      .get('/api/v1/test/permissions/reservations-approve')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
  });

  it('fails closed when the route has PermissionsGuard but no @RequirePermission metadata', async () => {
    if (!dbAvailable || !app) return;

    const { email, user } = await seedUser('no-metadata');
    await seedEmployee({ userId: user.id, roleGrantSlugs: ['reservations:approve'] });
    const { accessToken } = await login(email);

    await request(app.getHttpServer())
      .get('/api/v1/test/permissions/no-metadata')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
  });

  it('rejects a tampered JWT payload (signature no longer matches)', async () => {
    if (!dbAvailable || !app) return;

    const { email, user } = await seedUser('tamper');
    await seedEmployee({ userId: user.id, roleGrantSlugs: ['tables:manage'] });
    const { accessToken } = await login(email);

    const [headerB64, payloadB64, signatureB64] = accessToken.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64!, 'base64url').toString('utf8'));
    payload.permissions = ['reservations:approve'];
    const tamperedPayloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const tamperedToken = `${headerB64}.${tamperedPayloadB64}.${signatureB64}`;

    await request(app.getHttpServer())
      .get('/api/v1/test/permissions/reservations-approve')
      .set('Authorization', `Bearer ${tamperedToken}`)
      .expect(401);
  });

  it('ignores forged permissions supplied in the request body', async () => {
    if (!dbAvailable || !app) return;

    const { email, user } = await seedUser('forged-body');
    await seedEmployee({ userId: user.id, roleGrantSlugs: ['tables:manage'] });
    const { accessToken } = await login(email);

    await request(app.getHttpServer())
      .get('/api/v1/test/permissions/reservations-approve')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ permissions: ['reservations:approve'], organizationId: 'forged-org' })
      .expect(403);
  });

  it('ignores forged permissions supplied in request headers', async () => {
    if (!dbAvailable || !app) return;

    const { email, user } = await seedUser('forged-header');
    await seedEmployee({ userId: user.id, roleGrantSlugs: ['tables:manage'] });
    const { accessToken } = await login(email);

    await request(app.getHttpServer())
      .get('/api/v1/test/permissions/reservations-approve')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('x-permissions', 'reservations:approve')
      .set('x-actor-type', 'Employee')
      .expect(403);
  });

  it('re-resolves permissions on refresh and honors them on the new access token', async () => {
    if (!dbAvailable || !app) return;

    const { email, user } = await seedUser('refresh');
    await seedEmployee({ userId: user.id, roleGrantSlugs: ['reservations:approve'] });
    const { refreshToken } = await login(email);

    const refreshResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/test/permissions/reservations-approve')
      .set('Authorization', `Bearer ${refreshResponse.body.data.accessToken}`)
      .expect(200);
  });

  it('rejects a permission-protected request after logout-all, even with a not-yet-expired access token', async () => {
    if (!dbAvailable || !app) return;

    const { email, user } = await seedUser('logout-all');
    await seedEmployee({ userId: user.id, roleGrantSlugs: ['reservations:approve'] });
    const { accessToken } = await login(email);

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    const response = await request(app.getHttpServer())
      .get('/api/v1/test/permissions/reservations-approve')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
    expect(response.body.code).toBe('AUTH_INVALID_TOKEN');
  });

  it("keeps two Employees in different organizations from contaminating each other's resolved permissions", async () => {
    if (!dbAvailable || !app) return;

    const { email: emailA, user: userA } = await seedUser('tenant-a');
    const { email: emailB, user: userB } = await seedUser('tenant-b');
    await seedEmployee({ userId: userA.id, roleGrantSlugs: ['reservations:approve'] });
    await seedEmployee({ userId: userB.id, roleGrantSlugs: ['tables:manage'] });

    const { accessToken: tokenA } = await login(emailA);
    const { accessToken: tokenB } = await login(emailB);

    await request(app.getHttpServer())
      .get('/api/v1/test/permissions/reservations-approve')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/test/permissions/reservations-approve')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/v1/test/permissions/tables-manage')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(403);
  });
});
