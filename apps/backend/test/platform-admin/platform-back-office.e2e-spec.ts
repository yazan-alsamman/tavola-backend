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

  // ---------------------------------------------------------------------
  // Organization Delete/Restore (ADR-034 §4, Phase 19.4)
  // ---------------------------------------------------------------------

  it('deletes an Organization (soft delete, no cascade), generates a correctly-attributed audit row, then restores it - dependent Restaurant/OrganizationMember data is preserved throughout', async () => {
    if (!dbAvailable || !app) return;
    const { organizationId, restaurantId, ownerId } = await seedOrgWithRestaurant('org-delete');
    const { email } = await seedPlatformAdmin('org-delete-admin');
    const token = await loginPlatformAdmin(email);
    const correlationId = `${TEST_PREFIX}corr-${uniqueId()}`;

    const deleteRes = await authed(
      token,
      'post',
      `/api/v1/platform-admin/organizations/${organizationId}/delete`,
    )
      .set('x-correlation-id', correlationId)
      .send({})
      .expect(200);
    expect(deleteRes.body).toMatchObject({ success: true, message: expect.any(String), meta: {} });
    expect(deleteRes.body.data.deletedAt).not.toBeNull();

    const deletedOrg = await prisma.organization.findUnique({ where: { id: organizationId } });
    expect(deletedOrg?.deletedAt).not.toBeNull();
    expect(deletedOrg?.status).toBe('Active');

    // No cascade, ever - the Restaurant and its Owner membership are untouched.
    const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
    expect(restaurant?.status).toBe('Active');
    expect(restaurant?.deletedAt).toBeNull();
    const member = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: ownerId } },
    });
    expect(member?.role).toBe('Owner');
    expect(member?.status).toBe('Active');

    const auditRow = await prisma.auditLog.findFirst({
      where: { action: 'organization.deleted', targetId: organizationId },
      orderBy: { occurredAt: 'desc' },
    });
    expect(auditRow?.actorType).toBe('PlatformAdmin');
    expect(auditRow?.organizationId).toBe(organizationId);
    expect(auditRow?.correlationId).toBe(correlationId);

    const restoreRes = await authed(
      token,
      'post',
      `/api/v1/platform-admin/organizations/${organizationId}/restore`,
    )
      .send({})
      .expect(200);
    expect(restoreRes.body.data.deletedAt).toBeNull();

    const restoredOrg = await prisma.organization.findUnique({ where: { id: organizationId } });
    expect(restoredOrg?.deletedAt).toBeNull();

    const restoreAuditRow = await prisma.auditLog.findFirst({
      where: { action: 'organization.restored', targetId: organizationId },
      orderBy: { occurredAt: 'desc' },
    });
    expect(restoreAuditRow?.actorType).toBe('PlatformAdmin');
  });

  it('deleting an already-deleted Organization re-applies harmlessly (200, re-stamps deletedAt) rather than erroring', async () => {
    if (!dbAvailable || !app) return;
    const { organizationId } = await seedOrgWithRestaurant('org-redelete');
    const { email } = await seedPlatformAdmin('org-redelete-admin');
    const token = await loginPlatformAdmin(email);

    await authed(token, 'post', `/api/v1/platform-admin/organizations/${organizationId}/delete`)
      .send({})
      .expect(200);
    const firstDeletedAt = (await prisma.organization.findUnique({ where: { id: organizationId } }))
      ?.deletedAt;

    await authed(token, 'post', `/api/v1/platform-admin/organizations/${organizationId}/delete`)
      .send({})
      .expect(200);
    const secondDeletedAt = (
      await prisma.organization.findUnique({ where: { id: organizationId } })
    )?.deletedAt;

    expect(secondDeletedAt).not.toBeNull();
    expect(secondDeletedAt?.getTime()).toBeGreaterThanOrEqual(firstDeletedAt!.getTime());
  });

  it('rejects (409) restoring an Organization that is not currently deleted', async () => {
    if (!dbAvailable || !app) return;
    const { organizationId } = await seedOrgWithRestaurant('org-restore-conflict');
    const { email } = await seedPlatformAdmin('org-restore-conflict-admin');
    const token = await loginPlatformAdmin(email);

    await authed(token, 'post', `/api/v1/platform-admin/organizations/${organizationId}/restore`)
      .send({})
      .expect(409);
  });

  it('returns 404 for an unknown Organization id on both delete and restore (IDOR-safe)', async () => {
    if (!dbAvailable || !app) return;
    const { email } = await seedPlatformAdmin('org-delete-404');
    const token = await loginPlatformAdmin(email);
    const unknownId = randomUUID();

    await authed(token, 'post', `/api/v1/platform-admin/organizations/${unknownId}/delete`)
      .send({})
      .expect(404);
    await authed(token, 'post', `/api/v1/platform-admin/organizations/${unknownId}/restore`)
      .send({})
      .expect(404);
  });

  it('denies PlatformSupport on Organization delete/restore (403, mutation is PlatformAdmin-only), allows PlatformAdmin', async () => {
    if (!dbAvailable || !app) return;
    const { organizationId } = await seedOrgWithRestaurant('org-delete-rbac');
    const { email: supportEmail } = await seedPlatformAdmin(
      'org-delete-support',
      'PlatformSupport',
    );
    const supportToken = await loginPlatformAdmin(supportEmail);

    await authed(
      supportToken,
      'post',
      `/api/v1/platform-admin/organizations/${organizationId}/delete`,
    )
      .send({})
      .expect(403);

    const { email: adminEmail } = await seedPlatformAdmin('org-delete-rbac-admin');
    const adminToken = await loginPlatformAdmin(adminEmail);

    await authed(
      adminToken,
      'post',
      `/api/v1/platform-admin/organizations/${organizationId}/delete`,
    )
      .send({})
      .expect(200);
  });

  it('denies a non-PlatformAdmin actor entirely (Organization Owner token, representative of Customer/Employee - PlatformAdminGuard rejects any non-PlatformAdmin JWT identically, never reaching role-tier logic)', async () => {
    if (!dbAvailable || !app) return;
    const { organizationId } = await seedOrgWithRestaurant('org-delete-owner-denied');
    const ownerEmail = `${TEST_PREFIX}owner-denied-${uniqueId()}@example.com`;
    await seedOwnerAndOrganization(prisma, {
      email: ownerEmail,
      passwordHash,
      organizationName: `${TEST_PREFIX}OwnerDeniedOrg ${uniqueId()}`,
    });
    const ownerLoginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password: PASSWORD, deviceName: 'e2e', deviceType: 'web' })
      .expect(200);
    const ownerToken = ownerLoginRes.body.data.accessToken as string;

    await authed(
      ownerToken,
      'post',
      `/api/v1/platform-admin/organizations/${organizationId}/delete`,
    )
      .send({})
      .expect(403);
  });

  it('cross-tenant safety: deleting Organization A never affects Organization B', async () => {
    if (!dbAvailable || !app) return;
    const { organizationId: orgA, restaurantId: restaurantA } =
      await seedOrgWithRestaurant('org-cross-a');
    const { organizationId: orgB, restaurantId: restaurantB } =
      await seedOrgWithRestaurant('org-cross-b');
    const { email } = await seedPlatformAdmin('org-cross-admin');
    const token = await loginPlatformAdmin(email);

    await authed(token, 'post', `/api/v1/platform-admin/organizations/${orgA}/delete`)
      .send({})
      .expect(200);

    const deletedA = await prisma.organization.findUnique({ where: { id: orgA } });
    const untouchedB = await prisma.organization.findUnique({ where: { id: orgB } });
    expect(deletedA?.deletedAt).not.toBeNull();
    expect(untouchedB?.deletedAt).toBeNull();

    const restaurantAAfter = await prisma.restaurant.findUnique({ where: { id: restaurantA } });
    const restaurantBAfter = await prisma.restaurant.findUnique({ where: { id: restaurantB } });
    expect(restaurantAAfter?.status).toBe('Active');
    expect(restaurantAAfter?.deletedAt).toBeNull();
    expect(restaurantBAfter?.status).toBe('Active');
  });

  it('Swagger document exposes the Organization delete/restore routes', async () => {
    if (!dbAvailable || !app) return;
    const { SwaggerModule, DocumentBuilder } = await import('@nestjs/swagger');
    const document = SwaggerModule.createDocument(
      app as unknown as Parameters<typeof SwaggerModule.createDocument>[0],
      new DocumentBuilder().build(),
    );
    expect(document.paths).toHaveProperty('/api/v1/platform-admin/organizations/{id}/delete');
    expect(document.paths).toHaveProperty('/api/v1/platform-admin/organizations/{id}/restore');
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

  // Phase 19.1 targeted remediation: live verification of the previous phase
  // found POST /platform-admin/admins/:id/reactivate was not idempotent at
  // the audit/event layer (a redundant call on an already-active account
  // republished PlatformAdminAccountReactivatedEvent and wrote a second
  // audit_logs row). Real-HTTP proof the fix holds through the actual guard
  // stack, not just the use-case unit test.
  it('reactivate is idempotent: transitions once from revoked, then a repeat call on an already-active account writes no new audit row', async () => {
    if (!dbAvailable || !app) return;
    const { email } = await seedPlatformAdmin('reactivate-admin');
    const token = await loginPlatformAdmin(email);

    const targetEmail = `${TEST_PREFIX}reactivate-target-${uniqueId()}@example.com`;
    const targetUserId = randomUUID();
    const targetPlatformAdminId = randomUUID();
    await prisma.user.create({
      data: {
        id: targetUserId,
        firstName: 'Target',
        lastName: 'Support',
        email: targetEmail,
        passwordHash,
        language: 'en',
        status: 'Active',
        emailVerified: true,
      },
    });
    await prisma.platformAdmin.create({
      data: {
        id: targetPlatformAdminId,
        userId: targetUserId,
        role: 'PlatformSupport',
        revokedAt: new Date(),
      },
    });

    await authed(token, 'post', `/api/v1/platform-admin/admins/${targetPlatformAdminId}/reactivate`)
      .send({})
      .expect(200);

    const afterFirstCall = await prisma.platformAdmin.findUnique({
      where: { id: targetPlatformAdminId },
    });
    expect(afterFirstCall?.revokedAt).toBeNull();

    const auditRowsAfterFirstCall = await prisma.auditLog.findMany({
      where: {
        action: 'platform_admin.admin_account.reactivated',
        targetId: targetPlatformAdminId,
      },
    });
    expect(auditRowsAfterFirstCall).toHaveLength(1);

    // Repeat call on the now-already-active account.
    await authed(token, 'post', `/api/v1/platform-admin/admins/${targetPlatformAdminId}/reactivate`)
      .send({})
      .expect(200);

    const auditRowsAfterSecondCall = await prisma.auditLog.findMany({
      where: {
        action: 'platform_admin.admin_account.reactivated',
        targetId: targetPlatformAdminId,
      },
    });
    expect(auditRowsAfterSecondCall).toHaveLength(1);
  });
});
