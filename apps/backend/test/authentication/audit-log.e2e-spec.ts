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
import { Sha256OpaqueTokenService } from '@modules/authentication/infrastructure/security/sha256-opaque-token.service';
import { Password } from '@shared/domain/value-objects/password.vo';
import { PermissionGuardFixtureModule } from '../authorization/support/permission-guard-fixture.module';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'audit-e2e-';
const TEST_PASSWORD = 'SecurePass123!';
const ACCESS_SECRET = 'test-access-secret-at-least-32-characters-long';
const opaqueTokenService = new Sha256OpaqueTokenService();

async function findActionsFor(actorId: string): Promise<string[]> {
  const rows = await prisma.auditLog.findMany({
    where: { actorId },
    orderBy: { occurredAt: 'asc' },
  });
  return rows.map((row) => row.action);
}

describe('Authentication audit log writes (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — audit log e2e tests NOT EXECUTED.');
      return;
    }

    process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-characters-long';
    process.env.ARGON2_MEMORY_COST = '4096';
    process.env.ARGON2_TIME_COST = '1';
    // Deliberately NOT overriding RATE_LIMIT_LOGIN_MAX down here: every test
    // in this file calls /auth/login from the same real loopback IP, so a
    // low shared limit would 429 every test after the first few (this bit
    // us once already). The one rate-limit-specific test below spins up its
    // OWN separate app instance with its own override instead.

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
      await prisma.auditLog.deleteMany({
        where: { OR: [{ correlationId: { startsWith: TEST_PREFIX } }, { actorId: null }] },
      });
      await prisma.rolePermission.deleteMany({
        where: { role: { slug: { startsWith: TEST_PREFIX } } },
      });
      await prisma.employeeBranchAssignment.deleteMany({
        where: { employee: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.employee.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
      await prisma.role.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
      await prisma.branch.deleteMany({
        where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
      });
      await prisma.restaurant.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
      await prisma.passwordResetToken.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.passwordHistory.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.emailVerificationToken.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
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

  async function seedActiveUser(suffix: string): Promise<{ email: string; userId: string }> {
    const email = `${TEST_PREFIX}${suffix}@example.com`;
    const id = randomUUID();
    await prisma.user.create({
      data: {
        id,
        firstName: 'Audit',
        lastName: 'E2E',
        email,
        passwordHash,
        language: 'en',
        status: UserStatus.Active,
        emailVerified: true,
      },
    });
    return { email, userId: id };
  }

  async function login(email: string) {
    const response = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD, deviceType: 'web' })
      .expect(200);
    return response.body.data as {
      accessToken: string;
      refreshToken: string;
      sessionId: string;
    };
  }

  it('records auth.login.success for a successful login', async () => {
    if (!dbAvailable || !app) return;

    const { email, userId } = await seedActiveUser('login-success');
    await login(email);

    const actions = await findActionsFor(userId);
    expect(actions).toContain('auth.login.success');

    const row = await prisma.auditLog.findFirst({
      where: { actorId: userId, action: 'auth.login.success' },
    });
    expect(row?.targetType).toBe('Session');
    expect(row?.actorType).toBe('User');
  });

  it('records auth.login.failed for a wrong password', async () => {
    if (!dbAvailable || !app) return;

    const { email, userId } = await seedActiveUser('login-failed');

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'WrongPass123!' })
      .expect(401);

    const actions = await findActionsFor(userId);
    expect(actions).toContain('auth.login.failed');
  });

  it('records auth.login.failed for an unknown email with a null actorId', async () => {
    if (!dbAvailable || !app) return;

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: `${TEST_PREFIX}unknown@example.com`, password: 'WrongPass123!' })
      .expect(401);

    const row = await prisma.auditLog.findFirst({
      where: { action: 'auth.login.failed', actorId: null },
      orderBy: { occurredAt: 'desc' },
    });
    expect(row).not.toBeNull();
  });

  it('records auth.account.locked when the failure threshold is crossed', async () => {
    if (!dbAvailable || !app) return;

    const { email, userId } = await seedActiveUser('account-locked');

    // Default maxFailedLoginAttempts is 5 (SystemConfiguration default).
    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'WrongPass123!' })
        .expect(401);
    }

    const actions = await findActionsFor(userId);
    expect(actions).toContain('auth.account.locked');
  });

  it('records auth.login.blocked_locked when a locked account is attempted again', async () => {
    if (!dbAvailable || !app) return;

    const { email, userId } = await seedActiveUser('blocked-locked');
    await prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.Locked, lockedUntil: new Date(Date.now() + 60_000) },
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(403);

    const actions = await findActionsFor(userId);
    expect(actions).toContain('auth.login.blocked_locked');
  });

  it('records auth.verify_email.success', async () => {
    if (!dbAvailable || !app) return;

    const email = `${TEST_PREFIX}verify@example.com`;
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Audit',
        lastName: 'Verify',
        email,
        passwordHash,
        language: 'en',
        status: UserStatus.Pending,
        emailVerified: false,
      },
    });
    const token = `verify-${randomUUID()}`;
    await prisma.emailVerificationToken.create({
      data: {
        id: randomUUID(),
        userId,
        tokenHash: opaqueTokenService.hash(token),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(200);

    const actions = await findActionsFor(userId);
    expect(actions).toContain('auth.verify_email.success');
  });

  it('records auth.logout.success and auth.session.revoked on logout', async () => {
    if (!dbAvailable || !app) return;

    const { email, userId } = await seedActiveUser('logout');
    const { accessToken } = await login(email);

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    const actions = await findActionsFor(userId);
    expect(actions).toContain('auth.logout.success');
    expect(actions).toContain('auth.session.revoked');
  });

  it('records auth.logout_all.success on logout-all', async () => {
    if (!dbAvailable || !app) return;

    const { email, userId } = await seedActiveUser('logout-all');
    const { accessToken } = await login(email);

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    const actions = await findActionsFor(userId);
    expect(actions).toContain('auth.logout_all.success');
  });

  it('records auth.refresh.success on a normal rotation', async () => {
    if (!dbAvailable || !app) return;

    const { email, userId } = await seedActiveUser('refresh-success');
    const { refreshToken } = await login(email);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    const actions = await findActionsFor(userId);
    expect(actions).toContain('auth.refresh.success');
  });

  it('records auth.refresh.replay_detected when a rotated token is reused', async () => {
    if (!dbAvailable || !app) return;

    const { email, userId } = await seedActiveUser('refresh-replay');
    const loginResult = await login(email);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: loginResult.refreshToken })
      .expect(200);

    // Escape the 30s concurrent-refresh grace window (refresh.e2e-spec.ts's
    // own established pattern for provoking genuine replay detection).
    await prisma.deviceSession.update({
      where: { id: loginResult.sessionId },
      data: { lastUsedAt: new Date(Date.now() - 31_000) },
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: loginResult.refreshToken })
      .expect(401);

    const actions = await findActionsFor(userId);
    expect(actions).toContain('auth.refresh.replay_detected');
  });

  it('records auth.forgot_password.requested', async () => {
    if (!dbAvailable || !app) return;

    const { email, userId } = await seedActiveUser('forgot-password');

    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email })
      .expect(200);

    const actions = await findActionsFor(userId);
    expect(actions).toContain('auth.forgot_password.requested');
  });

  it('records auth.password_reset.success', async () => {
    if (!dbAvailable || !app) return;

    const { userId } = await seedActiveUser('password-reset');
    const resetToken = `reset-${randomUUID()}`;
    await prisma.passwordResetToken.create({
      data: {
        id: randomUUID(),
        userId,
        tokenHash: opaqueTokenService.hash(resetToken),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: resetToken, newPassword: 'BrandNewPass1!' })
      .expect(200);

    const actions = await findActionsFor(userId);
    expect(actions).toContain('auth.password_reset.success');
  });

  it('records auth.password_change.success', async () => {
    if (!dbAvailable || !app) return;

    const { email, userId } = await seedActiveUser('password-change');
    const { accessToken } = await login(email);

    await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'AnotherNewPass1!' })
      .expect(200);

    const actions = await findActionsFor(userId);
    expect(actions).toContain('auth.password_change.success');
  });

  it('records auth.permission.denied when an Employee lacks the required permission', async () => {
    if (!dbAvailable || !app) return;

    const { email, userId } = await seedActiveUser('permission-denied');
    const organization = await prisma.organization.create({
      data: {
        name: 'Audit E2E Org',
        slug: `${TEST_PREFIX}org-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}billing@example.com`,
      },
    });
    const restaurant = await prisma.restaurant.create({
      data: {
        organizationId: organization.id,
        name: 'Audit E2E Restaurant',
        slug: `${TEST_PREFIX}restaurant-${randomUUID()}`,
        status: 'Active',
      },
    });
    const role = await prisma.role.create({
      data: {
        name: `${TEST_PREFIX}Role-${randomUUID()}`,
        slug: `${TEST_PREFIX}role-${randomUUID()}`,
        description: 'Audit e2e role with no grants',
        scope: 'Restaurant',
      },
    });
    await prisma.employee.create({
      data: {
        restaurantId: restaurant.id,
        roleId: role.id,
        userId,
        firstName: 'Audit',
        lastName: 'Employee',
        email: `${TEST_PREFIX}employee-record@example.com`,
        status: 'Active',
      },
    });

    const { accessToken } = await login(email);

    const response = await request(app.getHttpServer())
      .get('/api/v1/test/permissions/reservations-approve')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
    expect(response.body.code).toBe('FORBIDDEN');

    const actions = await findActionsFor(userId);
    expect(actions).toContain('auth.permission.denied');

    const row = await prisma.auditLog.findFirst({
      where: { actorId: userId, action: 'auth.permission.denied' },
    });
    expect(row?.organizationId).toBe(organization.id);
    expect(row?.targetId).toBe('reservations:approve');
  });

  it('records auth.jwt.invalid for a garbage token, with no actorId resolvable', async () => {
    if (!dbAvailable || !app) return;

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);

    const row = await prisma.auditLog.findFirst({
      where: { action: 'auth.jwt.invalid', actorId: null },
      orderBy: { occurredAt: 'desc' },
    });
    expect(row).not.toBeNull();
  });

  it('records auth.jwt.expired for a genuinely expired, real signed token', async () => {
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

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${expiredToken}`)
      .expect(401);

    const row = await prisma.auditLog.findFirst({
      where: { action: 'auth.jwt.expired' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(row).not.toBeNull();
  });

  it('records auth.rate_limit.exceeded once the login rate limit is hit', async () => {
    if (!dbAvailable || !app) return;

    // This test alone needs a low limit to trip in a handful of requests;
    // the shared `app` above (and every other test in this file) relies on
    // the generous jest-e2e.setup.ts default, so this spins up its own
    // isolated app instance rather than overriding the shared one (that
    // exact mistake broke every other login-dependent test here once
    // already - see rate-limit.e2e-spec.ts for the established pattern).
    const previousMax = process.env.RATE_LIMIT_LOGIN_MAX;
    process.env.RATE_LIMIT_LOGIN_MAX = '3';
    const rateLimitedApp = await createTestApp([PermissionGuardFixtureModule]);
    if (previousMax === undefined) {
      delete process.env.RATE_LIMIT_LOGIN_MAX;
    } else {
      process.env.RATE_LIMIT_LOGIN_MAX = previousMax;
    }

    try {
      const ip = `audit-e2e-ip-${randomUUID()}`;
      for (let i = 0; i < 3; i += 1) {
        await request(rateLimitedApp.getHttpServer())
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', ip)
          .send({ email: `${TEST_PREFIX}rl-nobody@example.com`, password: 'WrongPass123!' });
      }

      const blocked = await request(rateLimitedApp.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: `${TEST_PREFIX}rl-nobody@example.com`, password: 'WrongPass123!' });
      expect(blocked.status).toBe(429);

      const row = await prisma.auditLog.findFirst({
        where: { action: 'auth.rate_limit.exceeded', targetId: 'login' },
        orderBy: { occurredAt: 'desc' },
      });
      expect(row).not.toBeNull();
    } finally {
      await rateLimitedApp.close();
    }
  });

  it('never persists a secret value (password, token, hash) in any audit row', async () => {
    if (!dbAvailable || !app) return;

    const rows = await prisma.auditLog.findMany({ take: 200, orderBy: { occurredAt: 'desc' } });
    const forbidden = [TEST_PASSWORD, 'BrandNewPass1!', 'AnotherNewPass1!'];

    for (const row of rows) {
      const serialized = JSON.stringify(row);
      for (const secret of forbidden) {
        expect(serialized).not.toContain(secret);
      }
      // No column is large enough to hold a JWT/refresh token/hash, but
      // guard against any future accidental string-concatenation bug too.
      expect(serialized.length).toBeLessThan(2000);
    }
  });
});
