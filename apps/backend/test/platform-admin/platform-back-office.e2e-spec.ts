import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword, seedOwnerAndOrganization } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'pbo_e2e_';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

/**
 * Phase 19.1 (ADR-034 subset) — real-HTTP proof of the Platform Back Office
 * foundation: two-tier RBAC (PlatformAdmin vs PlatformSupport), cross-tenant
 * IDOR-safety, audit-row generation with correct `actorType: 'PlatformAdmin'`
 * attribution, Restaurant/Organization lifecycle (including the new Restore
 * and Ownership Transfer capabilities), and Account access control.
 */
describe('Platform Back Office (e2e, Phase 19.1)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — Platform Back Office e2e tests NOT EXECUTED.');
      return;
    }
    passwordHash = await hashTestPassword(PASSWORD);
    app = await createTestApp();
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.auditLog.deleteMany({ where: { correlationId: { startsWith: TEST_PREFIX } } });
      await prisma.platformAdmin.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.deviceSession.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.tokenFamily.deleteMany({
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
        firstName: 'Platform',
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

  async function loginPlatformAdmin(email: string): Promise<string> {
    const response = await request(app!.getHttpServer())
      .post('/api/v1/platform-admin/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return response.body.data.accessToken as string;
  }

  async function seedOrgWithRestaurant(suffix: string) {
    const { userId: ownerId, organizationId } = await seedOwnerAndOrganization(prisma, {
      email: `${TEST_PREFIX}owner-${suffix}-${uniqueId()}@example.com`,
      passwordHash,
      organizationName: `${TEST_PREFIX}Org ${suffix} ${uniqueId()}`,
    });
    const restaurantId = randomUUID();
    const now = new Date();
    await prisma.restaurant.create({
      data: {
        id: restaurantId,
        organizationId,
        name: `${TEST_PREFIX}Restaurant ${suffix} ${uniqueId()}`,
        slug: `${TEST_PREFIX}restaurant-${suffix}-${uniqueId()}`,
        status: 'Active',
        createdAt: now,
        updatedAt: now,
      },
    });
    return { ownerId, organizationId, restaurantId };
  }

  function authed(token: string, method: 'post' | 'get' | 'patch', path: string) {
    return request(app!.getHttpServer())[method](path).set('Authorization', `Bearer ${token}`);
  }

  // ---------------------------------------------------------------------
  // RBAC (ADR-034 §11) — PlatformAdmin vs PlatformSupport
  // ---------------------------------------------------------------------

  it('denies PlatformSupport on a mutation route (403), allows PlatformAdmin', async () => {
    if (!dbAvailable || !app) return;
    const { restaurantId } = await seedOrgWithRestaurant('rbac');
    const { email: supportEmail } = await seedPlatformAdmin('rbac-support', 'PlatformSupport');
    const supportToken = await loginPlatformAdmin(supportEmail);

    await authed(supportToken, 'post', `/api/v1/platform-admin/restaurants/${restaurantId}/suspend`)
      .send({})
      .expect(403);

    const { email: adminEmail } = await seedPlatformAdmin('rbac-admin', 'PlatformAdmin');
    const adminToken = await loginPlatformAdmin(adminEmail);

    await authed(adminToken, 'post', `/api/v1/platform-admin/restaurants/${restaurantId}/suspend`)
      .send({})
      .expect(200);
  });

  it('allows PlatformSupport to read the admin account list (read-only capability)', async () => {
    if (!dbAvailable || !app) return;
    const { email: supportEmail } = await seedPlatformAdmin('rbac-read', 'PlatformSupport');
    const supportToken = await loginPlatformAdmin(supportEmail);

    await authed(supportToken, 'get', '/api/v1/platform-admin/admins').expect(200);
  });

  it('M6: denies PlatformSupport on an Organization mutation route (403), allows PlatformAdmin', async () => {
    if (!dbAvailable || !app) return;
    const { organizationId } = await seedOrgWithRestaurant('rbac-org');
    const { email: supportEmail } = await seedPlatformAdmin('rbac-org-support', 'PlatformSupport');
    const supportToken = await loginPlatformAdmin(supportEmail);

    await authed(
      supportToken,
      'post',
      `/api/v1/platform-admin/organizations/${organizationId}/suspend`,
    )
      .send({})
      .expect(403);

    const { email: adminEmail } = await seedPlatformAdmin('rbac-org-admin', 'PlatformAdmin');
    const adminToken = await loginPlatformAdmin(adminEmail);

    await authed(
      adminToken,
      'post',
      `/api/v1/platform-admin/organizations/${organizationId}/suspend`,
    )
      .send({})
      .expect(200);
  });

  it('M6: denies PlatformSupport on an Account-access mutation route (403), allows PlatformAdmin', async () => {
    if (!dbAvailable || !app) return;
    const { ownerId } = await seedOrgWithRestaurant('rbac-account');
    const { email: supportEmail } = await seedPlatformAdmin(
      'rbac-account-support',
      'PlatformSupport',
    );
    const supportToken = await loginPlatformAdmin(supportEmail);

    await authed(supportToken, 'post', `/api/v1/platform-admin/accounts/${ownerId}/disable-login`)
      .send({})
      .expect(403);

    const { email: adminEmail } = await seedPlatformAdmin('rbac-account-admin', 'PlatformAdmin');
    const adminToken = await loginPlatformAdmin(adminEmail);

    await authed(adminToken, 'post', `/api/v1/platform-admin/accounts/${ownerId}/disable-login`)
      .send({})
      .expect(200);
  });

  // ---------------------------------------------------------------------
  // Restaurant lifecycle (ADR-034 §3) + audit + IDOR
  // ---------------------------------------------------------------------

  it('suspends a Restaurant across any Organization, generates a correctly-attributed audit row, then reactivates/deletes/restores it', async () => {
    if (!dbAvailable || !app) return;
    const { restaurantId, organizationId } = await seedOrgWithRestaurant('lifecycle');
    const { email } = await seedPlatformAdmin('lifecycle-admin');
    const token = await loginPlatformAdmin(email);
    const correlationId = `${TEST_PREFIX}corr-${uniqueId()}`;

    await authed(token, 'post', `/api/v1/platform-admin/restaurants/${restaurantId}/suspend`)
      .set('x-correlation-id', correlationId)
      .send({})
      .expect(200);

    const auditRow = await prisma.auditLog.findFirst({
      where: { action: 'restaurant.suspended', targetId: restaurantId },
      orderBy: { occurredAt: 'desc' },
    });
    expect(auditRow?.actorType).toBe('PlatformAdmin');
    expect(auditRow?.organizationId).toBe(organizationId);

    await authed(token, 'post', `/api/v1/platform-admin/restaurants/${restaurantId}/reactivate`)
      .send({})
      .expect(200);
    await authed(token, 'post', `/api/v1/platform-admin/restaurants/${restaurantId}/delete`)
      .send({})
      .expect(200);

    const deleted = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
    expect(deleted?.deletedAt).not.toBeNull();

    // Restore - closes the standing "no restore capability" gap (ADR-034 §3).
    await authed(token, 'post', `/api/v1/platform-admin/restaurants/${restaurantId}/restore`)
      .send({})
      .expect(200);
    const restored = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
    expect(restored?.deletedAt).toBeNull();
  });

  it('returns 404 for an unknown Restaurant id (IDOR-safe, no organizationId is ever bound)', async () => {
    if (!dbAvailable || !app) return;
    const { email } = await seedPlatformAdmin('restaurant-404');
    const token = await loginPlatformAdmin(email);

    await authed(token, 'post', `/api/v1/platform-admin/restaurants/${randomUUID()}/suspend`)
      .send({})
      .expect(404);
  });

  // ---------------------------------------------------------------------
  // Organization lifecycle (ADR-034 §4/§5/§6)
  // ---------------------------------------------------------------------

  it('suspends an Organization WITHOUT cascading to its Restaurant.status (ADR-034 §5 - no cascade, ever)', async () => {
    if (!dbAvailable || !app) return;
    const { organizationId, restaurantId } = await seedOrgWithRestaurant('org-suspend');
    const { email } = await seedPlatformAdmin('org-suspend-admin');
    const token = await loginPlatformAdmin(email);

    await authed(token, 'post', `/api/v1/platform-admin/organizations/${organizationId}/suspend`)
      .send({})
      .expect(200);

    const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
    expect(organization?.status).toBe('Suspended');
    const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
    expect(restaurant?.status).toBe('Active');

    await authed(token, 'post', `/api/v1/platform-admin/organizations/${organizationId}/reactivate`)
      .send({})
      .expect(200);
  });

  it('emergency-transfers Organization ownership to another Active member (ADR-034 §6)', async () => {
    if (!dbAvailable || !app) return;
    const { organizationId, ownerId } = await seedOrgWithRestaurant('transfer');
    const newOwnerUserId = randomUUID();
    await prisma.user.create({
      data: {
        id: newOwnerUserId,
        firstName: 'New',
        lastName: 'Owner',
        email: `${TEST_PREFIX}new-owner-${uniqueId()}@example.com`,
        passwordHash,
        language: 'en',
        status: 'Active',
        emailVerified: true,
      },
    });
    await prisma.organizationMember.create({
      data: {
        id: randomUUID(),
        organizationId,
        userId: newOwnerUserId,
        role: 'Admin',
        status: 'Active',
        invitedAt: new Date(),
        joinedAt: new Date(),
      },
    });
    const { email } = await seedPlatformAdmin('transfer-admin');
    const token = await loginPlatformAdmin(email);

    await authed(
      token,
      'post',
      `/api/v1/platform-admin/organizations/${organizationId}/transfer-ownership`,
    )
      .send({ newOwnerUserId })
      .expect(200);

    const newOwner = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: newOwnerUserId } },
    });
    const previousOwner = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: ownerId } },
    });
    expect(newOwner?.role).toBe('Owner');
    expect(previousOwner?.role).toBe('Admin');
  });

  // ---------------------------------------------------------------------
  // Account access control (ADR-034 §8)
  // ---------------------------------------------------------------------

  it('force-logs-out a target account (revokes all sessions) and disables/re-enables its login', async () => {
    if (!dbAvailable || !app) return;
    const { ownerId } = await seedOrgWithRestaurant('account-access');
    const { email } = await seedPlatformAdmin('account-access-admin');
    const token = await loginPlatformAdmin(email);

    await authed(token, 'post', `/api/v1/platform-admin/accounts/${ownerId}/force-logout`)
      .send({})
      .expect(200);

    const afterLogout = await prisma.user.findUnique({ where: { id: ownerId } });
    expect(afterLogout?.sessionVersion).toBeGreaterThan(1);

    await authed(token, 'post', `/api/v1/platform-admin/accounts/${ownerId}/disable-login`)
      .send({})
      .expect(200);
    const disabled = await prisma.user.findUnique({ where: { id: ownerId } });
    expect(disabled?.status).toBe('Suspended');

    await authed(token, 'post', `/api/v1/platform-admin/accounts/${ownerId}/enable-login`)
      .send({})
      .expect(200);
    const enabled = await prisma.user.findUnique({ where: { id: ownerId } });
    expect(enabled?.status).toBe('Active');
  });

  // ---------------------------------------------------------------------
  // Platform Admin account CRUD (ADR-034 §10) + self-lockout
  // ---------------------------------------------------------------------

  it('creates a new Platform Admin account and prevents an admin from deactivating their own account', async () => {
    if (!dbAvailable || !app) return;
    const { email } = await seedPlatformAdmin('crud-admin');
    const token = await loginPlatformAdmin(email);

    const createResponse = await authed(token, 'post', '/api/v1/platform-admin/admins')
      .send({
        email: `${TEST_PREFIX}created-${uniqueId()}@example.com`,
        password: PASSWORD,
        firstName: 'New',
        lastName: 'Admin',
        role: 'PlatformSupport',
      })
      .expect(201);
    expect(createResponse.body.data.role).toBe('PlatformSupport');

    const selfUser = await prisma.user.findUnique({ where: { email } });
    const self = await prisma.platformAdmin.findUnique({ where: { userId: selfUser!.id } });

    await authed(token, 'post', `/api/v1/platform-admin/admins/${self!.id}/deactivate`)
      .send({})
      .expect(409);
  });
});
