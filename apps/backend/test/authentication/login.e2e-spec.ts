import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, UserStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { createTestApp } from '../helpers/test-app.factory';
import { Argon2PasswordHasher } from '@modules/authentication/infrastructure/security/argon2-password-hasher';
import { Password } from '@shared/domain/value-objects/password.vo';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import authConfig from '@config/auth.config';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'login-e2e-';
const TEST_PASSWORD = 'SecurePass123!';

describe('POST /api/v1/auth/login (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn(
        'PostgreSQL not reachable — skipping login e2e tests. Start Docker stack per ENVIRONMENT_SETUP.md.',
      );
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
    passwordHash = (await hasher.hash(Password.create(TEST_PASSWORD))).value;

    app = await createTestApp();
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.rolePermission.deleteMany({
        where: { role: { slug: { startsWith: TEST_PREFIX } } },
      });
      await prisma.employeeBranchAssignment.deleteMany({
        where: { employee: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.employee.deleteMany({
        where: { email: { startsWith: TEST_PREFIX } },
      });
      await prisma.role.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
      await prisma.branch.deleteMany({
        where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
      });
      await prisma.restaurant.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
      await prisma.organizationMember.deleteMany({
        where: { organization: { slug: { startsWith: TEST_PREFIX } } },
      });
      await prisma.organization.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
      await prisma.loginAttempt.deleteMany({
        where: { identifier: { startsWith: TEST_PREFIX } },
      });
      await prisma.deviceSession.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.tokenFamily.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.user.deleteMany({
        where: { email: { startsWith: TEST_PREFIX } },
      });
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  async function seedActiveUser(
    suffix: string,
    overrides?: Partial<{ status: UserStatus; emailVerified: boolean }>,
  ) {
    const email = `${TEST_PREFIX}${suffix}@example.com`;
    await prisma.user.create({
      data: {
        id: randomUUID(),
        firstName: 'E2E',
        lastName: 'Login',
        email,
        passwordHash,
        language: 'en',
        status: overrides?.status ?? UserStatus.Active,
        emailVerified: overrides?.emailVerified ?? true,
      },
    });
    return { email };
  }

  it('returns enveloped login response for valid credentials', async () => {
    if (!dbAvailable || !app) {
      return;
    }

    const { email } = await seedActiveUser('success');

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD, deviceName: 'E2E Device', deviceType: 'web' })
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      message: 'Login successful.',
      data: {
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        accessTokenExpiresAt: expect.any(String),
        refreshTokenExpiresAt: expect.any(String),
        user: expect.objectContaining({
          email,
          status: UserStatus.Active,
          emailVerified: true,
        }),
        organization: null,
        sessionId: expect.any(String),
        sessionVersion: 1,
        permissionsVersion: 1,
        actorType: 'User',
        requiresPasswordChange: false,
      },
      meta: {},
    });

    const session = await prisma.deviceSession.findFirst({
      where: { user: { email } },
    });
    expect(session?.refreshTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(session?.refreshTokenHash).not.toBe(response.body.data.refreshToken);
  });

  it('returns AUTH_INVALID_CREDENTIALS for wrong password', async () => {
    if (!dbAvailable || !app) {
      return;
    }

    const { email } = await seedActiveUser('wrong-password');

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'WrongPass123!' })
      .expect(401);

    expect(response.body.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('returns AUTH_EMAIL_NOT_VERIFIED for pending users', async () => {
    if (!dbAvailable || !app) {
      return;
    }

    const { email } = await seedActiveUser('pending', {
      status: UserStatus.Pending,
      emailVerified: false,
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(403);

    expect(response.body.code).toBe('AUTH_EMAIL_NOT_VERIFIED');
  });

  it('issues an OrganizationMember actor JWT for a user with an active organization membership', async () => {
    if (!dbAvailable || !app) {
      return;
    }

    const { email } = await seedActiveUser('org-member');
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });

    const organization = await prisma.organization.create({
      data: {
        name: 'E2E Org Member Org',
        slug: `${TEST_PREFIX}org-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}billing@example.com`,
      },
    });
    await prisma.organizationMember.create({
      data: { organizationId: organization.id, userId: user.id, role: 'Admin', status: 'Active' },
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);

    expect(response.body.data.actorType).toBe('OrganizationMember');
    expect(response.body.data.permissionsVersion).toBe(1);
    expect(response.body.data.organization).toEqual({
      organizationId: organization.id,
      name: organization.name,
      slug: organization.slug,
      role: 'Admin',
    });

    const decoded = jwt.decode(response.body.data.accessToken) as Record<string, unknown>;
    expect(decoded.actorType).toBe('OrganizationMember');
    expect(decoded.organizationId).toBe(organization.id);
    expect(decoded.orgRole).toBe('Admin');
  });

  it('issues an Employee actor JWT carrying resolved RBAC permissions', async () => {
    if (!dbAvailable || !app) {
      return;
    }

    const { email } = await seedActiveUser('employee');
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });

    const organization = await prisma.organization.create({
      data: {
        name: 'E2E Employee Org',
        slug: `${TEST_PREFIX}org-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}billing2@example.com`,
      },
    });
    const restaurant = await prisma.restaurant.create({
      data: {
        organizationId: organization.id,
        name: 'E2E Employee Restaurant',
        slug: `${TEST_PREFIX}restaurant-${randomUUID()}`,
        status: 'Active',
      },
    });
    const branch = await prisma.branch.create({
      data: {
        restaurantId: restaurant.id,
        city: 'E2E City',
        address: '1 E2E Street',
        countryCode: 'US',
        timezone: 'UTC',
      },
    });
    const role = await prisma.role.create({
      data: {
        name: `${TEST_PREFIX}Manager-${randomUUID()}`,
        slug: `${TEST_PREFIX}manager-${randomUUID()}`,
        description: 'E2E manager role',
        scope: 'Restaurant',
      },
    });
    const permissionSlug = `${TEST_PREFIX}reservations-approve-${randomUUID()}`;
    const permission = await prisma.permission.create({
      data: { slug: permissionSlug, description: 'E2E approve' },
    });
    await prisma.rolePermission.create({
      data: { roleId: role.id, permissionId: permission.id, type: 'RoleGrant' },
    });
    const employee = await prisma.employee.create({
      data: {
        restaurantId: restaurant.id,
        roleId: role.id,
        userId: user.id,
        firstName: 'E2E',
        lastName: 'Employee',
        email: `${TEST_PREFIX}employee-record@example.com`,
        status: 'Active',
      },
    });
    await prisma.employeeBranchAssignment.create({
      data: { employeeId: employee.id, branchId: branch.id, assignedAt: new Date() },
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);

    expect(response.body.data.actorType).toBe('Employee');
    expect(response.body.data.permissionsVersion).toBe(1);

    const decoded = jwt.decode(response.body.data.accessToken) as Record<string, unknown>;
    expect(decoded.actorType).toBe('Employee');
    expect(decoded.employeeId).toBe(employee.id);
    expect(decoded.organizationId).toBe(organization.id);
    expect(decoded.restaurantId).toBe(restaurant.id);
    expect(decoded.branchIds).toEqual([branch.id]);
    expect(decoded.permissions).toEqual([permissionSlug]);
  });
});
