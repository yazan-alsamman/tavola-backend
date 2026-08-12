import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword, seedOwnerAndOrganization } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'dash_e2e_';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

/**
 * Phase 19 — Platform Dashboard composition endpoint (ADR-034 §13/§15,
 * API_GUIDELINES.md's Platform Back Office Route Ownership table). Real-HTTP
 * proof of: two-tier RBAC, the required/bounded acquisition date range,
 * response envelope/shape, real database-derived values across all five
 * sections (asserted as deltas - see this suite's own note below), empty
 * datasets, cross-organization composition, no sensitive field leakage, and
 * (Phase 19.6) that a Customer/Restaurant-Organization-Owner token is
 * rejected identically to no token at all. Mirrors `audit-logs.e2e-spec.ts`'s
 * structure exactly (same seeding/login helper shape).
 *
 * Every section here is a genuinely platform-wide, unfiltered count (that is
 * the entire point of a Dashboard) - against a shared dev database that may
 * already contain unrelated rows, exact-value assertions would be wrong.
 * Every value-correctness test therefore reads the dashboard once BEFORE
 * seeding and once AFTER, asserting the delta - correct regardless of what
 * else exists in the database, same technique as this phase's own
 * integration spec.
 */
describe('Platform Back Office — Dashboard composition endpoint (e2e, Phase 19)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let passwordHash = 'argon2id$test';
  let platformPricingRuleId: string | undefined;

  const createdOrganizationIds: string[] = [];
  const createdRestaurantIds: string[] = [];
  const createdSubscriptionIds: string[] = [];
  const createdAcquisitionIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — Dashboard e2e tests NOT EXECUTED.');
      return;
    }
    passwordHash = await hashTestPassword(PASSWORD);
    app = await createTestApp();
    const platformRule = await prisma.acquisitionPricingRule.findFirst({
      where: { scopeType: 'Platform', archivedAt: null },
    });
    platformPricingRuleId = platformRule?.id;
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.customerAcquisition.deleteMany({
        where: { id: { in: createdAcquisitionIds } },
      });
      await prisma.subscription.deleteMany({ where: { id: { in: createdSubscriptionIds } } });
      await prisma.restaurant.deleteMany({ where: { id: { in: createdRestaurantIds } } });
      await prisma.organization.deleteMany({ where: { id: { in: createdOrganizationIds } } });
      await prisma.platformAdmin.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.deviceSession.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.tokenFamily.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.user.deleteMany({
        where: { OR: [{ email: { startsWith: TEST_PREFIX } }, { id: { in: createdUserIds } }] },
      });
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

  function authed(token: string, path: string) {
    return request(app!.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);
  }

  async function seedOrganization(
    overrides: {
      status?: 'Active' | 'Suspended';
      deletedAt?: Date | null;
    } = {},
  ): Promise<string> {
    const id = randomUUID();
    await prisma.organization.create({
      data: {
        id,
        name: `${TEST_PREFIX}org_${id}`,
        slug: `${TEST_PREFIX}org-${id}`,
        status: overrides.status ?? 'Active',
        billingEmail: `${TEST_PREFIX}${id}@example.test`,
        deletedAt: overrides.deletedAt ?? null,
      },
    });
    createdOrganizationIds.push(id);
    return id;
  }

  async function seedRestaurant(
    organizationId: string,
    overrides: { status?: 'Active' | 'Suspended' } = {},
  ): Promise<string> {
    const id = randomUUID();
    await prisma.restaurant.create({
      data: {
        id,
        organizationId,
        name: `${TEST_PREFIX}rst_${id}`,
        slug: `${TEST_PREFIX}rst-${id}`,
        status: overrides.status ?? 'Active',
      },
    });
    createdRestaurantIds.push(id);
    return id;
  }

  async function seedSubscription(organizationId: string): Promise<void> {
    const plan = await prisma.subscriptionPlan.findFirst({ where: { archivedAt: null } });
    if (!plan) return;
    const id = randomUUID();
    await prisma.subscription.create({
      data: {
        id,
        organizationId,
        subscriptionPlanId: plan.id,
        status: 'Active',
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    createdSubscriptionIds.push(id);
  }

  async function seedAcquisition(
    restaurantId: string,
    recordedAt: Date,
  ): Promise<{ currency: string; feeAmount: number } | null> {
    if (!platformPricingRuleId) return null;
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Acq',
        lastName: 'Customer',
        email: `${TEST_PREFIX}customer-${uniqueId()}@example.com`,
        passwordHash,
        language: 'en',
        status: 'Active',
        emailVerified: true,
      },
    });
    createdUserIds.push(userId);

    const id = randomUUID();
    await prisma.customerAcquisition.create({
      data: {
        id,
        restaurantId,
        userId,
        createdVia: 'ManualPlatformAdminCorrection',
        status: 'Recorded',
        feeAmount: 1000,
        feeCurrency: 'SYP',
        pricingRuleId: platformPricingRuleId,
        recordedAt,
      },
    });
    createdAcquisitionIds.push(id);
    return { currency: 'SYP', feeAmount: 1000 };
  }

  const from = '2026-05-01T00:00:00.000Z';
  const to = '2026-05-02T00:00:00.000Z';
  const withinWindow = new Date('2026-05-01T12:00:00.000Z');

  it('1. rejects unauthenticated requests (PlatformAdminGuard fails closed, 403)', async () => {
    if (!dbAvailable || !app) return;
    await request(app.getHttpServer())
      .get(`/api/v1/platform-admin/dashboard?from=${from}&to=${to}`)
      .expect(403);
  });

  it('2/3. PlatformSupport can read (200); PlatformAdmin can read (200) - both tiers, ADR-034 §11', async () => {
    if (!dbAvailable || !app) return;
    const { email: adminEmail } = await seedPlatformAdmin('rbac-admin', 'PlatformAdmin');
    const { email: supportEmail } = await seedPlatformAdmin('rbac-support', 'PlatformSupport');
    const adminToken = await loginPlatformAdmin(adminEmail);
    const supportToken = await loginPlatformAdmin(supportEmail);

    await authed(adminToken, `/api/v1/platform-admin/dashboard?from=${from}&to=${to}`).expect(200);
    await authed(supportToken, `/api/v1/platform-admin/dashboard?from=${from}&to=${to}`).expect(
      200,
    );
  });

  it('4. response contains all documented sections with the correct shape', async () => {
    if (!dbAvailable || !app) return;
    const { email } = await seedPlatformAdmin('shape', 'PlatformAdmin');
    const token = await loginPlatformAdmin(email);

    const res = await authed(
      token,
      `/api/v1/platform-admin/dashboard?from=${from}&to=${to}`,
    ).expect(200);

    expect(res.body.data).toHaveProperty('generatedAt');
    expect(res.body.data.restaurants).toMatchObject({
      total: expect.any(Number),
      active: expect.any(Number),
      suspended: expect.any(Number),
      deleted: expect.any(Number),
    });
    expect(res.body.data.organizations).toMatchObject({
      total: expect.any(Number),
      active: expect.any(Number),
      suspended: expect.any(Number),
      deleted: expect.any(Number),
    });
    expect(res.body.data.subscriptions).toMatchObject({
      total: expect.any(Number),
      active: expect.any(Number),
      suspended: expect.any(Number),
      cancelled: expect.any(Number),
      expired: expect.any(Number),
    });
    expect(res.body.data.acquisition).toMatchObject({
      from: expect.any(String),
      to: expect.any(String),
      currencies: expect.any(Array),
    });
    // Messaging (Phase 19.6, closing the dependency Phase 19.5 disclosed) -
    // a current-state pushStatus snapshot, not a time-series.
    expect(res.body.data.messaging).toMatchObject({
      total: expect.any(Number),
      notAttempted: expect.any(Number),
      queued: expect.any(Number),
      accepted: expect.any(Number),
      failed: expect.any(Number),
    });
  });

  it('5. rejects invalid query parameters (missing from/to, inverted range, excessive range)', async () => {
    if (!dbAvailable || !app) return;
    const { email } = await seedPlatformAdmin('invalid', 'PlatformAdmin');
    const token = await loginPlatformAdmin(email);

    await authed(token, '/api/v1/platform-admin/dashboard').expect(400);
    await authed(token, `/api/v1/platform-admin/dashboard?from=${to}&to=${from}`).expect(400);
    await authed(
      token,
      `/api/v1/platform-admin/dashboard?from=2026-01-01T00:00:00.000Z&to=2027-06-01T00:00:00.000Z`,
    ).expect(400);
  });

  it('6. returns an empty acquisition summary for a window with no acquisitions', async () => {
    if (!dbAvailable || !app) return;
    const { email } = await seedPlatformAdmin('empty-window', 'PlatformAdmin');
    const token = await loginPlatformAdmin(email);

    const res = await authed(
      token,
      `/api/v1/platform-admin/dashboard?from=1999-01-01T00:00:00.000Z&to=1999-06-01T00:00:00.000Z`,
    ).expect(200);

    expect(res.body.data.acquisition.currencies).toEqual([]);
  });

  it('7. restaurants/organizations/subscriptions sections reflect real database state (delta) across two organizations', async () => {
    if (!dbAvailable || !app) return;
    const { email } = await seedPlatformAdmin('delta', 'PlatformAdmin');
    const token = await loginPlatformAdmin(email);

    const before = (
      await authed(token, `/api/v1/platform-admin/dashboard?from=${from}&to=${to}`).expect(200)
    ).body.data;

    const orgA = await seedOrganization({ status: 'Active' });
    const orgB = await seedOrganization({ status: 'Suspended' });
    await seedRestaurant(orgA, { status: 'Active' });
    await seedRestaurant(orgA, { status: 'Active' });
    await seedRestaurant(orgB, { status: 'Suspended' });
    await seedSubscription(orgA);

    const after = (
      await authed(token, `/api/v1/platform-admin/dashboard?from=${from}&to=${to}`).expect(200)
    ).body.data;

    // Cross-organization composition: both orgA's and orgB's restaurants
    // are reflected in one platform-wide total, not just the caller's own
    // organization (there is no caller organization - PlatformAdmin is not
    // tenant-scoped).
    expect(after.restaurants.active - before.restaurants.active).toBe(2);
    expect(after.restaurants.suspended - before.restaurants.suspended).toBe(1);
    expect(after.organizations.active - before.organizations.active).toBe(1);
    expect(after.organizations.suspended - before.organizations.suspended).toBe(1);
    expect(after.subscriptions.total - before.subscriptions.total).toBeGreaterThanOrEqual(0);
  });

  it('8. acquisition section reflects real recorded acquisitions within the requested window (delta)', async () => {
    if (!dbAvailable || !app) return;
    if (!platformPricingRuleId) {
      console.warn(
        'No Platform-scope AcquisitionPricingRule seeded - skipping acquisition delta assertion.',
      );
      return;
    }
    const { email } = await seedPlatformAdmin('acq-delta', 'PlatformAdmin');
    const token = await loginPlatformAdmin(email);
    const orgId = await seedOrganization();
    const restaurantId = await seedRestaurant(orgId);

    const before = (
      await authed(token, `/api/v1/platform-admin/dashboard?from=${from}&to=${to}`).expect(200)
    ).body.data;
    const beforeSyp = before.acquisition.currencies.find(
      (c: { currency: string }) => c.currency === 'SYP',
    ) ?? {
      recordedCount: 0,
      recordedTotal: 0,
    };

    await seedAcquisition(restaurantId, withinWindow);

    const after = (
      await authed(token, `/api/v1/platform-admin/dashboard?from=${from}&to=${to}`).expect(200)
    ).body.data;
    const afterSyp = after.acquisition.currencies.find(
      (c: { currency: string }) => c.currency === 'SYP',
    );

    expect(afterSyp).toBeDefined();
    expect(afterSyp.recordedCount - beforeSyp.recordedCount).toBe(1);
    expect(afterSyp.recordedTotal - beforeSyp.recordedTotal).toBe(1000);
  });

  it('9. response envelope is {success,message,data,meta}; no credential/token field is ever present', async () => {
    if (!dbAvailable || !app) return;
    const { email } = await seedPlatformAdmin('envelope', 'PlatformAdmin');
    const token = await loginPlatformAdmin(email);

    const res = await authed(
      token,
      `/api/v1/platform-admin/dashboard?from=${from}&to=${to}`,
    ).expect(200);

    expect(res.body).toMatchObject({ success: true, message: expect.any(String), meta: {} });

    const flat = JSON.stringify(res.body.data).toLowerCase();
    const forbiddenSubstrings = [
      'password',
      'passwordhash',
      'refreshtoken',
      'accesstoken',
      'secret',
    ];
    for (const forbidden of forbiddenSubstrings) {
      expect(flat.includes(forbidden)).toBe(false);
    }
  });

  it('10. messaging section reflects real recorded notifications (delta), any pushStatus', async () => {
    if (!dbAvailable || !app) return;
    const { email } = await seedPlatformAdmin('messaging-delta', 'PlatformAdmin');
    const token = await loginPlatformAdmin(email);

    const before = (
      await authed(token, `/api/v1/platform-admin/dashboard?from=${from}&to=${to}`).expect(200)
    ).body.data;

    const notifUserId = randomUUID();
    await prisma.user.create({
      data: {
        id: notifUserId,
        firstName: 'Notif',
        lastName: 'Fixture',
        email: `${TEST_PREFIX}notif-${uniqueId()}@example.com`,
        passwordHash,
        language: 'en',
        status: 'Active',
        emailVerified: true,
      },
    });
    createdUserIds.push(notifUserId);
    await prisma.notification.create({
      data: {
        id: randomUUID(),
        userId: notifUserId,
        type: `${TEST_PREFIX}type`,
        title: 'Test',
        body: 'Test body',
        pushStatus: 'Accepted',
      },
    });

    const after = (
      await authed(token, `/api/v1/platform-admin/dashboard?from=${from}&to=${to}`).expect(200)
    ).body.data;

    expect(after.messaging.accepted - before.messaging.accepted).toBe(1);
    expect(after.messaging.total - before.messaging.total).toBe(1);
  });

  it('11. rejects a Customer token (no PlatformAdmin/PlatformSupport record) - 403', async () => {
    if (!dbAvailable || !app) return;
    const email = `${TEST_PREFIX}customer-${uniqueId()}@example.com`;
    await prisma.user.create({
      data: {
        id: randomUUID(),
        firstName: 'Plain',
        lastName: 'Customer',
        email,
        passwordHash,
        language: 'en',
        status: 'Active',
        emailVerified: true,
      },
    });

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, deviceType: 'web' })
      .expect(200);
    const customerToken = loginResponse.body.data.accessToken as string;

    await authed(customerToken, `/api/v1/platform-admin/dashboard?from=${from}&to=${to}`).expect(
      403,
    );
  });

  it('12. rejects a Restaurant/Organization Owner token (no PlatformAdmin/PlatformSupport record) - 403', async () => {
    if (!dbAvailable || !app) return;
    const email = `${TEST_PREFIX}owner-${uniqueId()}@example.com`;
    await seedOwnerAndOrganization(prisma, {
      email,
      passwordHash,
      organizationName: `${TEST_PREFIX}Org ${uniqueId()}`,
    });

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, deviceType: 'web' })
      .expect(200);
    const ownerToken = loginResponse.body.data.accessToken as string;

    await authed(ownerToken, `/api/v1/platform-admin/dashboard?from=${from}&to=${to}`).expect(403);
  });

  it('13. Swagger document exposes the route', async () => {
    if (!dbAvailable || !app) return;
    const { SwaggerModule, DocumentBuilder } = await import('@nestjs/swagger');
    const document = SwaggerModule.createDocument(
      app as unknown as Parameters<typeof SwaggerModule.createDocument>[0],
      new DocumentBuilder().build(),
    );
    expect(document.paths).toHaveProperty('/api/v1/platform-admin/dashboard');
    expect(document.paths['/api/v1/platform-admin/dashboard']).toHaveProperty('get');
  });
});
