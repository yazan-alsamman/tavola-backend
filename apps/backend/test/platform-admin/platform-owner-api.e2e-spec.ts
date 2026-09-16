import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword, seedOwnerAndOrganization } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'powner_e2e_';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

/**
 * Real-HTTP proof of the Platform Owner (Farid Dashboard) API surface added
 * 2026-09-15 (ADR-038 session lifecycle, ADR-039 login status codes), against
 * real PostgreSQL through the real guard/interceptor/filter stack.
 *
 * Covers the nine endpoints that had no e2e coverage, plus the behaviours the
 * dashboard depends on and which unit tests cannot prove end to end: the
 * response envelope, real token rotation and replay revocation, and that an
 * empty `q` returns the ordinary page rather than nothing.
 */
describe('Platform Owner API (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — Platform Owner API e2e tests NOT EXECUTED.');
      return;
    }
    passwordHash = await hashTestPassword(PASSWORD);
    app = await createTestApp();
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.auditLog.deleteMany({ where: { correlationId: { startsWith: TEST_PREFIX } } });
      await prisma.platformAdminSession.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.platformAdmin.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.restaurant.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
      await prisma.subscriptionUsage.deleteMany({
        where: { organization: { name: { startsWith: TEST_PREFIX } } },
      });
      await prisma.subscription.deleteMany({
        where: { organization: { name: { startsWith: TEST_PREFIX } } },
      });
      await prisma.organizationMember.deleteMany({
        where: { organization: { name: { startsWith: TEST_PREFIX } } },
      });
      await prisma.organization.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  async function seedPlatformAdmin(
    suffix: string,
    role: 'PlatformAdmin' | 'PlatformSupport' = 'PlatformAdmin',
  ): Promise<{ userId: string; email: string }> {
    const email = `${TEST_PREFIX}${suffix}-${uniqueId()}@example.com`;
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Farid',
        lastName: role,
        email,
        passwordHash,
        language: 'en',
        status: 'Active',
        emailVerified: true,
      },
    });
    await prisma.platformAdmin.create({
      data: { id: randomUUID(), userId, role, revokedAt: null },
    });
    return { userId, email };
  }

  interface SessionTokens {
    accessToken: string;
    refreshToken: string;
  }

  async function login(email: string): Promise<SessionTokens> {
    const response = await request(app!.getHttpServer())
      .post('/api/v1/platform-admin/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return {
      accessToken: response.body.data.accessToken as string,
      refreshToken: response.body.data.refreshToken as string,
    };
  }

  function authed(token: string, method: 'get' | 'post', path: string) {
    return request(app!.getHttpServer())[method](path).set('Authorization', `Bearer ${token}`);
  }

  async function seedOrg(suffix: string): Promise<{ organizationId: string }> {
    const { organizationId } = await seedOwnerAndOrganization(prisma, {
      email: `${TEST_PREFIX}owner-${suffix}-${uniqueId()}@example.com`,
      passwordHash,
      organizationName: `${TEST_PREFIX}Org ${suffix} ${uniqueId()}`,
    });
    return { organizationId };
  }

  // =====================================================================
  // Authentication / session lifecycle (ADR-038, ADR-039)
  // =====================================================================
  describe('POST /platform-admin/login', () => {
    it('issues an access token AND a refresh token, in the standard envelope', async () => {
      if (!dbAvailable || !app) return;
      const { email, userId } = await seedPlatformAdmin('login');

      const response = await request(app.getHttpServer())
        .post('/api/v1/platform-admin/login')
        .send({ email, password: PASSWORD })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Login successful.');
      expect(response.body.data).toMatchObject({
        tokenType: 'Bearer',
        platformAdminUserId: userId,
        role: 'PlatformAdmin',
      });
      expect(typeof response.body.data.accessToken).toBe('string');
      expect(typeof response.body.data.refreshToken).toBe('string');

      // The session row exists and stores only the digest, never the token.
      const sessions = await prisma.platformAdminSession.findMany({
        where: { platformAdminUserId: userId },
      });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].refreshTokenHash).not.toBe(response.body.data.refreshToken);
      expect(sessions[0].revokedAt).toBeNull();
    });

    it('returns 401 AUTH_INVALID_CREDENTIALS for a wrong password', async () => {
      if (!dbAvailable || !app) return;
      const { email } = await seedPlatformAdmin('badpw');

      const response = await request(app.getHttpServer())
        .post('/api/v1/platform-admin/login')
        .send({ email, password: 'WrongPass123!' })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('returns 401 AUTH_INVALID_CREDENTIALS - NOT 400 - for a wrong password that fails the creation policy (ADR-039)', async () => {
      if (!dbAvailable || !app) return;
      const { email } = await seedPlatformAdmin('weakpw');

      // 'short' violates every PasswordPolicy rule. Before ADR-039 this
      // returned 400 VALIDATION_ERROR from `Password.create()` before the
      // hash was ever compared - leaking an oracle and bypassing lockout.
      const response = await request(app.getHttpServer())
        .post('/api/v1/platform-admin/login')
        .send({ email, password: 'short' })
        .expect(401);

      expect(response.body.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('returns 401 AUTH_INVALID_CREDENTIALS for an unknown email (indistinguishable from a wrong password)', async () => {
      if (!dbAvailable || !app) return;

      const response = await request(app.getHttpServer())
        .post('/api/v1/platform-admin/login')
        .send({ email: `${TEST_PREFIX}nobody-${uniqueId()}@example.com`, password: PASSWORD })
        .expect(401);

      expect(response.body.code).toBe('AUTH_INVALID_CREDENTIALS');
    });
  });

  describe('POST /platform-admin/refresh', () => {
    it('rotates the refresh token and issues a new access token', async () => {
      if (!dbAvailable || !app) return;
      const { email, userId } = await seedPlatformAdmin('refresh');
      const first = await login(email);

      const response = await request(app.getHttpServer())
        .post('/api/v1/platform-admin/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(200);

      expect(response.body.message).toBe('Session refreshed successfully.');
      expect(response.body.data.refreshToken).not.toBe(first.refreshToken);
      expect(response.body.data.platformAdminUserId).toBe(userId);

      // Still exactly one session - rotated in place, not duplicated.
      const sessions = await prisma.platformAdminSession.findMany({
        where: { platformAdminUserId: userId },
      });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].previousRefreshTokenHash).not.toBeNull();

      // The new access token actually works.
      await authed(
        response.body.data.accessToken as string,
        'get',
        '/api/v1/platform-admin/me',
      ).expect(200);
    });

    it('rejects the old token after rotation, and a replay revokes every session for that admin', async () => {
      if (!dbAvailable || !app) return;
      const { email, userId } = await seedPlatformAdmin('replay');
      const first = await login(email);
      // A second, independent console session for the same admin.
      await login(email);

      const rotated = await request(app.getHttpServer())
        .post('/api/v1/platform-admin/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(200);

      // Replaying the consumed token is indistinguishable from theft.
      const replay = await request(app.getHttpServer())
        .post('/api/v1/platform-admin/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(401);
      expect(replay.body.code).toBe('AUTH_INVALID_REFRESH_TOKEN');

      // Blast radius is every session that admin holds, not just the replayed one.
      const sessions = await prisma.platformAdminSession.findMany({
        where: { platformAdminUserId: userId },
      });
      expect(sessions).toHaveLength(2);
      for (const session of sessions) {
        expect(session.revokedAt).not.toBeNull();
        expect(session.revokedReason).toBe('reuse_detected');
      }

      // Even the token minted by the successful rotation is now dead.
      await request(app.getHttpServer())
        .post('/api/v1/platform-admin/refresh')
        .send({ refreshToken: rotated.body.data.refreshToken })
        .expect(401);
    });

    it('rejects an unknown refresh token with 401 AUTH_INVALID_REFRESH_TOKEN', async () => {
      if (!dbAvailable || !app) return;

      const response = await request(app.getHttpServer())
        .post('/api/v1/platform-admin/refresh')
        .send({ refreshToken: 'not-a-real-refresh-token' })
        .expect(401);

      expect(response.body.code).toBe('AUTH_INVALID_REFRESH_TOKEN');
    });
  });

  describe('POST /platform-admin/logout', () => {
    it('revokes the session (204) so the refresh token stops working', async () => {
      if (!dbAvailable || !app) return;
      const { email, userId } = await seedPlatformAdmin('logout');
      const session = await login(email);

      await authed(session.accessToken, 'post', '/api/v1/platform-admin/logout')
        .send({ refreshToken: session.refreshToken })
        .expect(204);

      const rows = await prisma.platformAdminSession.findMany({
        where: { platformAdminUserId: userId },
      });
      expect(rows[0].revokedAt).not.toBeNull();
      expect(rows[0].revokedReason).toBe('logout');

      await request(app.getHttpServer())
        .post('/api/v1/platform-admin/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(401);
    });

    it('is idempotent - a second logout with the same token still returns 204', async () => {
      if (!dbAvailable || !app) return;
      const { email } = await seedPlatformAdmin('logout-idem');
      const session = await login(email);

      await authed(session.accessToken, 'post', '/api/v1/platform-admin/logout')
        .send({ refreshToken: session.refreshToken })
        .expect(204);
      await authed(session.accessToken, 'post', '/api/v1/platform-admin/logout')
        .send({ refreshToken: session.refreshToken })
        .expect(204);
    });

    it('will not let one admin revoke another admin session (non-enumerating 204, no revocation)', async () => {
      if (!dbAvailable || !app) return;
      const attacker = await seedPlatformAdmin('logout-attacker');
      const victim = await seedPlatformAdmin('logout-victim');
      const attackerSession = await login(attacker.email);
      const victimSession = await login(victim.email);

      await authed(attackerSession.accessToken, 'post', '/api/v1/platform-admin/logout')
        .send({ refreshToken: victimSession.refreshToken })
        .expect(204);

      const victimRows = await prisma.platformAdminSession.findMany({
        where: { platformAdminUserId: victim.userId },
      });
      expect(victimRows[0].revokedAt).toBeNull();
      // And the victim can still refresh.
      await request(app.getHttpServer())
        .post('/api/v1/platform-admin/refresh')
        .send({ refreshToken: victimSession.refreshToken })
        .expect(200);
    });
  });

  describe('GET /platform-admin/me', () => {
    it('returns identity and the live role, without password or version fields', async () => {
      if (!dbAvailable || !app) return;
      const { email, userId } = await seedPlatformAdmin('me');
      const session = await login(email);

      const response = await authed(session.accessToken, 'get', '/api/v1/platform-admin/me').expect(
        200,
      );

      expect(response.body.message).toBe('Current Platform Admin retrieved successfully.');
      expect(response.body.data).toMatchObject({
        userId,
        email,
        role: 'PlatformAdmin',
        status: 'Active',
      });
      expect(response.body.data).not.toHaveProperty('passwordHash');
      expect(response.body.data).not.toHaveProperty('sessionVersion');
      expect(response.body.data).not.toHaveProperty('permissionsVersion');
    });

    it('is available to PlatformSupport and reports its own tier', async () => {
      if (!dbAvailable || !app) return;
      const { email } = await seedPlatformAdmin('me-support', 'PlatformSupport');
      const session = await login(email);

      const response = await authed(session.accessToken, 'get', '/api/v1/platform-admin/me').expect(
        200,
      );
      expect(response.body.data.role).toBe('PlatformSupport');
    });

    it('returns 401 without a token', async () => {
      if (!dbAvailable || !app) return;
      await request(app.getHttpServer()).get('/api/v1/platform-admin/me').expect(401);
    });
  });

  describe('Deactivation revokes sessions', () => {
    it('closes every live session of a deactivated admin', async () => {
      if (!dbAvailable || !app) return;
      const actor = await seedPlatformAdmin('deact-actor');
      const target = await seedPlatformAdmin('deact-target', 'PlatformSupport');
      const actorSession = await login(actor.email);
      const targetSession = await login(target.email);

      const targetAdmin = await prisma.platformAdmin.findUnique({
        where: { userId: target.userId },
      });

      await authed(
        actorSession.accessToken,
        'post',
        `/api/v1/platform-admin/admins/${targetAdmin!.id}/deactivate`,
      ).expect(200);

      const rows = await prisma.platformAdminSession.findMany({
        where: { platformAdminUserId: target.userId },
      });
      expect(rows[0].revokedAt).not.toBeNull();
      expect(rows[0].revokedReason).toBe('admin');

      // The deactivated admin can neither refresh nor use its access token.
      await request(app.getHttpServer())
        .post('/api/v1/platform-admin/refresh')
        .send({ refreshToken: targetSession.refreshToken })
        .expect(401);
      await authed(targetSession.accessToken, 'get', '/api/v1/platform-admin/me').expect(403);
    });
  });

  // =====================================================================
  // Restaurants
  // =====================================================================
  describe('Restaurant APIs', () => {
    it('creates a restaurant under a named organization and returns it as detail (201)', async () => {
      if (!dbAvailable || !app) return;
      const { email } = await seedPlatformAdmin('rst-create');
      const session = await login(email);
      const { organizationId } = await seedOrg('rst-create');
      const name = `${TEST_PREFIX}Created ${uniqueId()}`;

      const response = await authed(
        session.accessToken,
        'post',
        '/api/v1/platform-admin/restaurants',
      )
        .send({ organizationId, name, description: 'Cozy', cuisineType: 'Italian', priceLevel: 2 })
        .expect(201);

      expect(response.body.message).toBe('Restaurant created successfully.');
      expect(response.body.data).toMatchObject({
        name,
        status: 'Active',
        branchCount: 0,
        deletedAt: null,
        organization: { id: organizationId },
      });

      // Genuinely persisted, with its mandatory RestaurantSettings row - the
      // invariant that delegating to CreateRestaurantUseCase preserves.
      const created = await prisma.restaurant.findUnique({
        where: { id: response.body.data.id },
        include: { settings: true },
      });
      expect(created).not.toBeNull();
      expect(created!.organizationId).toBe(organizationId);
      expect(created!.settings).not.toBeNull();
    });

    it('rejects creation for an unknown organization with 404', async () => {
      if (!dbAvailable || !app) return;
      const { email } = await seedPlatformAdmin('rst-404org');
      const session = await login(email);

      await authed(session.accessToken, 'post', '/api/v1/platform-admin/restaurants')
        .send({
          organizationId: randomUUID(),
          name: `${TEST_PREFIX}Orphan ${uniqueId()}`,
        })
        .expect(404);
    });

    it('denies creation to PlatformSupport (403) - mutation is PlatformAdmin-only', async () => {
      if (!dbAvailable || !app) return;
      const { email } = await seedPlatformAdmin('rst-support', 'PlatformSupport');
      const session = await login(email);
      const { organizationId } = await seedOrg('rst-support');

      await authed(session.accessToken, 'post', '/api/v1/platform-admin/restaurants')
        .send({ organizationId, name: `${TEST_PREFIX}Denied ${uniqueId()}` })
        .expect(403);
    });

    it('returns 400 for a malformed body', async () => {
      if (!dbAvailable || !app) return;
      const { email } = await seedPlatformAdmin('rst-400');
      const session = await login(email);

      const response = await authed(
        session.accessToken,
        'post',
        '/api/v1/platform-admin/restaurants',
      )
        .send({ organizationId: 'not-a-uuid', name: '' })
        .expect(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('GET /:id returns full detail; unknown id is 404; invalid uuid is 400', async () => {
      if (!dbAvailable || !app) return;
      const { email } = await seedPlatformAdmin('rst-detail');
      const session = await login(email);
      const { organizationId } = await seedOrg('rst-detail');
      const name = `${TEST_PREFIX}Detail ${uniqueId()}`;
      const created = await authed(
        session.accessToken,
        'post',
        '/api/v1/platform-admin/restaurants',
      )
        .send({ organizationId, name })
        .expect(201);

      const detail = await authed(
        session.accessToken,
        'get',
        `/api/v1/platform-admin/restaurants/${created.body.data.id}`,
      ).expect(200);
      expect(detail.body.message).toBe('Restaurant retrieved successfully.');
      expect(detail.body.data.name).toBe(name);
      expect(detail.body.data.organization.id).toBe(organizationId);

      await authed(
        session.accessToken,
        'get',
        `/api/v1/platform-admin/restaurants/${randomUUID()}`,
      ).expect(404);

      await authed(
        session.accessToken,
        'get',
        '/api/v1/platform-admin/restaurants/not-a-uuid',
      ).expect(400);

      await request(app.getHttpServer())
        .get(`/api/v1/platform-admin/restaurants/${created.body.data.id}`)
        .expect(401);
    });

    it('list: empty q returns the normal page, and status partitions correctly', async () => {
      if (!dbAvailable || !app) return;
      const { email } = await seedPlatformAdmin('rst-list');
      const session = await login(email);
      const { organizationId } = await seedOrg('rst-list');
      const token = uniqueId();
      const activeName = `${TEST_PREFIX}ListActive ${token}`;

      const created = await authed(
        session.accessToken,
        'post',
        '/api/v1/platform-admin/restaurants',
      )
        .send({ organizationId, name: activeName })
        .expect(201);

      // Empty q must return the ordinary paginated list, not nothing.
      const empty = await authed(
        session.accessToken,
        'get',
        '/api/v1/platform-admin/restaurants?q=&page=1&limit=100',
      ).expect(200);
      expect(empty.body.data.total).toBeGreaterThan(0);
      expect(empty.body.data).toMatchObject({ page: 1, limit: 100 });

      // Whitespace-only q behaves identically.
      const whitespace = await authed(
        session.accessToken,
        'get',
        '/api/v1/platform-admin/restaurants?q=%20%20%20&page=1&limit=100',
      ).expect(200);
      expect(whitespace.body.data.total).toBe(empty.body.data.total);

      const filteredActive = await authed(
        session.accessToken,
        'get',
        `/api/v1/platform-admin/restaurants?q=${token}&status=Active&page=1&limit=20`,
      ).expect(200);
      expect(filteredActive.body.data.items.map((r: { name: string }) => r.name)).toEqual([
        activeName,
      ]);
      expect(filteredActive.body.data.total).toBe(1);

      // Suspend it, and it moves between partitions.
      await authed(
        session.accessToken,
        'post',
        `/api/v1/platform-admin/restaurants/${created.body.data.id}/suspend`,
      ).expect(200);

      const nowActive = await authed(
        session.accessToken,
        'get',
        `/api/v1/platform-admin/restaurants?q=${token}&status=Active&page=1&limit=20`,
      ).expect(200);
      expect(nowActive.body.data.items).toEqual([]);
      expect(nowActive.body.data.total).toBe(0);

      const nowSuspended = await authed(
        session.accessToken,
        'get',
        `/api/v1/platform-admin/restaurants?q=${token}&status=Suspended&page=1&limit=20`,
      ).expect(200);
      expect(nowSuspended.body.data.total).toBe(1);
    });

    it('list: rejects an invalid status value with 400', async () => {
      if (!dbAvailable || !app) return;
      const { email } = await seedPlatformAdmin('rst-badstatus');
      const session = await login(email);

      await authed(
        session.accessToken,
        'get',
        '/api/v1/platform-admin/restaurants?status=Bogus',
      ).expect(400);
    });
  });

  // =====================================================================
  // Organizations
  // =====================================================================
  describe('Organization APIs', () => {
    it('GET /:id returns detail with live counts; unknown id is 404', async () => {
      if (!dbAvailable || !app) return;
      const { email } = await seedPlatformAdmin('org-detail');
      const session = await login(email);
      const { organizationId } = await seedOrg('org-detail');

      await authed(session.accessToken, 'post', '/api/v1/platform-admin/restaurants')
        .send({ organizationId, name: `${TEST_PREFIX}OrgCount ${uniqueId()}` })
        .expect(201);

      const detail = await authed(
        session.accessToken,
        'get',
        `/api/v1/platform-admin/organizations/${organizationId}`,
      ).expect(200);

      expect(detail.body.message).toBe('Organization retrieved successfully.');
      expect(detail.body.data.id).toBe(organizationId);
      expect(detail.body.data.restaurantCount).toBe(1);
      expect(detail.body.data.memberCount).toBeGreaterThanOrEqual(1);
      expect(detail.body.data.deletedAt).toBeNull();

      await authed(
        session.accessToken,
        'get',
        `/api/v1/platform-admin/organizations/${randomUUID()}`,
      ).expect(404);

      await request(app.getHttpServer())
        .get(`/api/v1/platform-admin/organizations/${organizationId}`)
        .expect(401);
    });

    it('list: empty q returns the normal page; status filter partitions', async () => {
      if (!dbAvailable || !app) return;
      const { email } = await seedPlatformAdmin('org-list');
      const session = await login(email);
      const { organizationId } = await seedOrg('org-list');

      const empty = await authed(
        session.accessToken,
        'get',
        '/api/v1/platform-admin/organizations?q=&page=1&limit=100',
      ).expect(200);
      expect(empty.body.data.total).toBeGreaterThan(0);

      await authed(
        session.accessToken,
        'post',
        `/api/v1/platform-admin/organizations/${organizationId}/suspend`,
      ).expect(200);

      const suspended = await authed(
        session.accessToken,
        'get',
        '/api/v1/platform-admin/organizations?status=Suspended&page=1&limit=100',
      ).expect(200);
      expect(suspended.body.data.items.map((o: { id: string }) => o.id)).toContain(organizationId);

      const active = await authed(
        session.accessToken,
        'get',
        '/api/v1/platform-admin/organizations?status=Active&page=1&limit=100',
      ).expect(200);
      expect(active.body.data.items.map((o: { id: string }) => o.id)).not.toContain(organizationId);
    });
  });

  // =====================================================================
  // Accounts — the lookup that removes the manual-UUID workaround
  // =====================================================================
  describe('Account APIs', () => {
    it('lists accounts with empty q, and the returned userId feeds the detail endpoint', async () => {
      if (!dbAvailable || !app) return;
      const { email } = await seedPlatformAdmin('acct-list');
      const session = await login(email);

      const list = await authed(
        session.accessToken,
        'get',
        '/api/v1/platform-admin/accounts?q=&page=1&limit=20',
      ).expect(200);

      expect(list.body.message).toBe('Accounts retrieved successfully.');
      expect(list.body.data.total).toBeGreaterThan(0);
      expect(list.body.data.items.length).toBeGreaterThan(0);
      expect(list.body.data).toMatchObject({ page: 1, limit: 20 });

      // The whole point: a console discovers a userId here, never by hand.
      const discoveredUserId = list.body.data.items[0].userId as string;
      const detail = await authed(
        session.accessToken,
        'get',
        `/api/v1/platform-admin/accounts/${discoveredUserId}`,
      ).expect(200);

      expect(detail.body.data.userId).toBe(discoveredUserId);
      expect(detail.body.data).toHaveProperty('activeSessionCount');
      expect(detail.body.data).toHaveProperty('organizations');
      expect(detail.body.data).not.toHaveProperty('passwordHash');
    });

    it('searches by email and reports a total consistent with the filter', async () => {
      if (!dbAvailable || !app) return;
      const { email } = await seedPlatformAdmin('acct-search');
      const session = await login(email);

      const found = await authed(
        session.accessToken,
        'get',
        `/api/v1/platform-admin/accounts?q=${encodeURIComponent(email)}&page=1&limit=20`,
      ).expect(200);

      expect(found.body.data.total).toBe(1);
      expect(found.body.data.items[0].email).toBe(email);
      expect(found.body.data.items[0].accountType).toBe('PlatformAdmin');

      const none = await authed(
        session.accessToken,
        'get',
        `/api/v1/platform-admin/accounts?q=${TEST_PREFIX}no-such-account-${uniqueId()}`,
      ).expect(200);
      expect(none.body.data.items).toEqual([]);
      expect(none.body.data.total).toBe(0);
    });

    it('whitespace-only q returns the same total as an empty q', async () => {
      if (!dbAvailable || !app) return;
      const { email } = await seedPlatformAdmin('acct-ws');
      const session = await login(email);

      const [blank, whitespace] = await Promise.all([
        authed(session.accessToken, 'get', '/api/v1/platform-admin/accounts?q=&page=1&limit=5'),
        authed(
          session.accessToken,
          'get',
          '/api/v1/platform-admin/accounts?q=%20%20&page=1&limit=5',
        ),
      ]);

      expect(whitespace.status).toBe(200);
      expect(whitespace.body.data.total).toBe(blank.body.data.total);
    });

    it('returns 404 for an unknown userId and 401 unauthenticated', async () => {
      if (!dbAvailable || !app) return;
      const { email } = await seedPlatformAdmin('acct-404');
      const session = await login(email);

      await authed(
        session.accessToken,
        'get',
        `/api/v1/platform-admin/accounts/${randomUUID()}`,
      ).expect(404);

      await request(app.getHttpServer()).get('/api/v1/platform-admin/accounts').expect(401);
    });
  });

  // =====================================================================
  // Notifications — real persisted broadcast state
  // =====================================================================
  describe('GET /platform-admin/notifications', () => {
    it('returns broadcast history reflecting real persisted state', async () => {
      if (!dbAvailable || !app) return;
      const { email, userId } = await seedPlatformAdmin('notif');
      const session = await login(email);

      // Write a broadcast row directly so the assertion is about what the
      // endpoint reports, not about the fan-out worker's timing.
      const broadcastId = randomUUID();
      await prisma.notificationBroadcast.create({
        data: {
          id: broadcastId,
          senderType: 'PlatformAdmin',
          senderId: userId,
          organizationId: null,
          title: `${TEST_PREFIX}Maintenance`,
          body: 'Scheduled maintenance window.',
          totalRecipients: 10,
          processedCount: 10,
          succeededCount: 9,
          failedCount: 1,
          status: 'Completed',
        },
      });

      const response = await authed(
        session.accessToken,
        'get',
        '/api/v1/platform-admin/notifications?page=1&limit=50',
      ).expect(200);

      expect(response.body.message).toBe('Notification broadcasts retrieved successfully.');
      const row = response.body.data.items.find((b: { id: string }) => b.id === broadcastId);
      expect(row).toBeDefined();
      expect(row).toMatchObject({
        senderType: 'PlatformAdmin',
        senderId: userId,
        status: 'Completed',
        totalRecipients: 10,
        processedCount: 10,
        succeededCount: 9,
        failedCount: 1,
      });

      await prisma.notificationBroadcast.delete({ where: { id: broadcastId } });
    });

    it('filters by status and returns a correct empty state', async () => {
      if (!dbAvailable || !app) return;
      const { email } = await seedPlatformAdmin('notif-filter');
      const session = await login(email);

      const response = await authed(
        session.accessToken,
        'get',
        '/api/v1/platform-admin/notifications?status=Failed&page=1&limit=20',
      ).expect(200);

      expect(Array.isArray(response.body.data.items)).toBe(true);
      for (const item of response.body.data.items) {
        expect(item.status).toBe('Failed');
      }
      expect(response.body.data).toMatchObject({ page: 1, limit: 20 });
    });

    it('rejects an invalid status with 400 and is unauthenticated-safe (401)', async () => {
      if (!dbAvailable || !app) return;
      const { email } = await seedPlatformAdmin('notif-400');
      const session = await login(email);

      await authed(
        session.accessToken,
        'get',
        '/api/v1/platform-admin/notifications?status=Bogus',
      ).expect(400);

      await request(app.getHttpServer()).get('/api/v1/platform-admin/notifications').expect(401);
    });
  });
});
