import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PlatformAdminRole, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword, seedOwnerAndOrganization } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'sub_e2e_';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

/**
 * Phase 12 (Subscriptions, architecture frozen 2026-07-28, ADR-027;
 * implementation 2026-07-28). Real-HTTP proof of the frozen authorization
 * matrix (D9/D22/D23/D24), the full PlatformAdmin lifecycle (Assign ->
 * Suspend -> Reactivate -> Cancel -> Assign/resume), Owner/Admin read-only
 * visibility, and - end to end through the real API, not just the
 * repository layer - that `maxRestaurants` actually blocks Restaurant
 * creation once reached.
 */
describe('Subscriptions (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let ordinaryPasswordHash = 'argon2id$test';
  let defaultPlanId: string;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable - subscriptions e2e tests NOT EXECUTED.');
      return;
    }
    ordinaryPasswordHash = await hashTestPassword(PASSWORD);
    app = await createTestApp();
    const defaultPlan = await prisma.subscriptionPlan.findUnique({ where: { slug: 'default' } });
    if (!defaultPlan) {
      throw new Error('Default SubscriptionPlan not seeded - run prisma:seed first.');
    }
    defaultPlanId = defaultPlan.id;
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.subscriptionUsage.deleteMany({
        where: { organization: { name: { startsWith: TEST_PREFIX } } },
      });
      await prisma.subscription.deleteMany({
        where: { organization: { name: { startsWith: TEST_PREFIX } } },
      });
      await prisma.restaurantUsage.deleteMany({
        where: { restaurant: { organization: { name: { startsWith: TEST_PREFIX } } } },
      });
      await prisma.restaurant.deleteMany({
        where: { organization: { name: { startsWith: TEST_PREFIX } } },
      });
      await prisma.organizationMember.deleteMany({
        where: { organization: { name: { startsWith: TEST_PREFIX } } },
      });
      await prisma.organization.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
      await prisma.subscriptionPlan.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
      await prisma.deviceSession.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.tokenFamily.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.platformAdmin.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  async function seedPlatformAdmin(suffix: string): Promise<string> {
    const email = `${TEST_PREFIX}pa-${suffix}-${uniqueId()}@example.com`;
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
      data: { id: randomUUID(), userId, role: PlatformAdminRole.PlatformAdmin, revokedAt: null },
    });
    const response = await request(app!.getHttpServer())
      .post('/api/v1/platform-admin/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return response.body.data.accessToken as string;
  }

  async function seedOwner(suffix: string): Promise<{ organizationId: string; token: string }> {
    const email = `${TEST_PREFIX}owner-${suffix}-${uniqueId()}@example.com`;
    const { organizationId } = await seedOwnerAndOrganization(prisma, {
      email,
      passwordHash: ordinaryPasswordHash,
      organizationName: `${TEST_PREFIX}Org ${suffix} ${uniqueId()}`,
    });
    const loginResponse = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, deviceType: 'web' })
      .expect(200);
    return { organizationId, token: loginResponse.body.data.accessToken as string };
  }

  // ---------------------------------------------------------------------
  // Default provisioning (D7) - proven via the real Owner-provisioning route
  // ---------------------------------------------------------------------

  it('a newly provisioned Organization automatically receives an Active default Subscription', async () => {
    if (!dbAvailable || !app) return;
    const paToken = await seedPlatformAdmin('provision-default');

    const response = await request(app.getHttpServer())
      .post('/api/v1/platform-admin/restaurant-owners')
      .set('Authorization', `Bearer ${paToken}`)
      .send({
        email: `${TEST_PREFIX}newowner-${uniqueId()}@example.com`,
        password: PASSWORD,
        firstName: 'New',
        lastName: 'Owner',
        organizationName: `${TEST_PREFIX}Fresh Org ${uniqueId()}`,
        consents: { termsOfService: true, privacyPolicy: true },
      })
      .expect(201);

    const organizationId = response.body.data.organizationId as string;
    const subscription = await prisma.subscription.findUnique({ where: { organizationId } });
    expect(subscription).not.toBeNull();
    expect(subscription?.status).toBe('Active');
    expect(subscription?.subscriptionPlanId).toBe(defaultPlanId);
    const usage = await prisma.subscriptionUsage.findUnique({ where: { organizationId } });
    expect(usage?.restaurantCount).toBe(0);
  });

  // ---------------------------------------------------------------------
  // PlatformAdmin lifecycle
  // ---------------------------------------------------------------------

  it('PlatformAdmin: list plans (read-only)', async () => {
    if (!dbAvailable || !app) return;
    const paToken = await seedPlatformAdmin('list-plans');

    const response = await request(app.getHttpServer())
      .get('/api/v1/platform-admin/plans')
      .set('Authorization', `Bearer ${paToken}`)
      .expect(200);

    expect(Array.isArray(response.body.data.items)).toBe(true);
    expect(response.body.data.items.some((p: { slug: string }) => p.slug === 'default')).toBe(true);
  });

  it('PlatformAdmin: full lifecycle - assign -> suspend -> reactivate -> cancel -> resume', async () => {
    if (!dbAvailable || !app) return;
    const paToken = await seedPlatformAdmin('lifecycle');
    const { organizationId } = await seedOwner('lifecycle');
    // seedOwnerAndOrganization already assigns the default plan directly at
    // the DB level (fixture parity with ProvisionRestaurantOwnerUseCase) -
    // remove it here so this test can exercise Assign via the real endpoint
    // from a clean slate.
    await prisma.subscriptionUsage.deleteMany({ where: { organizationId } });
    await prisma.subscription.deleteMany({ where: { organizationId } });

    const assign = await request(app.getHttpServer())
      .post(`/api/v1/platform-admin/organizations/${organizationId}/subscription`)
      .set('Authorization', `Bearer ${paToken}`)
      .send({ planId: defaultPlanId })
      .expect(200);
    expect(assign.body.data.status).toBe('Active');

    const suspend = await request(app.getHttpServer())
      .post(`/api/v1/platform-admin/organizations/${organizationId}/subscription/suspend`)
      .set('Authorization', `Bearer ${paToken}`)
      .expect(200);
    expect(suspend.body.data.status).toBe('Suspended');

    const reactivate = await request(app.getHttpServer())
      .post(`/api/v1/platform-admin/organizations/${organizationId}/subscription/reactivate`)
      .set('Authorization', `Bearer ${paToken}`)
      .expect(200);
    expect(reactivate.body.data.status).toBe('Active');

    const cancel = await request(app.getHttpServer())
      .post(`/api/v1/platform-admin/organizations/${organizationId}/subscription/cancel`)
      .set('Authorization', `Bearer ${paToken}`)
      .expect(200);
    expect(cancel.body.data.status).toBe('Cancelled');

    const resumed = await request(app.getHttpServer())
      .post(`/api/v1/platform-admin/organizations/${organizationId}/subscription`)
      .set('Authorization', `Bearer ${paToken}`)
      .send({ planId: defaultPlanId })
      .expect(200);
    expect(resumed.body.data.status).toBe('Active');
  });

  it('PlatformAdmin: GET organization subscription reflects current state', async () => {
    if (!dbAvailable || !app) return;
    const paToken = await seedPlatformAdmin('get-sub');
    const { organizationId } = await seedOwner('get-sub');

    const response = await request(app.getHttpServer())
      .get(`/api/v1/platform-admin/organizations/${organizationId}/subscription`)
      .set('Authorization', `Bearer ${paToken}`)
      .expect(200);
    expect(response.body.data.organizationId).toBe(organizationId);
    expect(response.body.data.status).toBe('Active');
  });

  it('PlatformAdmin: 409 assigning an archived plan', async () => {
    if (!dbAvailable || !app) return;
    const paToken = await seedPlatformAdmin('archived-plan');
    const { organizationId } = await seedOwner('archived-plan');
    const archivedPlan = await prisma.subscriptionPlan.create({
      data: {
        name: `${TEST_PREFIX}Archived Plan ${uniqueId()}`,
        slug: `${TEST_PREFIX}archived-${uniqueId()}`,
        maxRestaurants: 5,
        maxBranchesPerRestaurant: 5,
        maxEmployeesPerRestaurant: 5,
        archivedAt: new Date(),
      },
    });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/platform-admin/organizations/${organizationId}/subscription`)
      .set('Authorization', `Bearer ${paToken}`)
      .send({ planId: archivedPlan.id })
      .expect(409);
    expect(response.body.code).toBe('CONFLICT');
  });

  it('PlatformAdmin: 403 SUBSCRIPTION_LIMIT_EXCEEDED downgrading below current usage', async () => {
    if (!dbAvailable || !app) return;
    const paToken = await seedPlatformAdmin('downgrade');
    const { organizationId, token: ownerToken } = await seedOwner('downgrade');

    // Create 2 restaurants under the generous default plan (max 10).
    for (let i = 0; i < 2; i += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/restaurants')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: `${TEST_PREFIX}Restaurant ${i}-${uniqueId()}` })
        .expect(201);
    }

    const tinyPlan = await prisma.subscriptionPlan.create({
      data: {
        name: `${TEST_PREFIX}Tiny Plan ${uniqueId()}`,
        slug: `${TEST_PREFIX}tiny-${uniqueId()}`,
        maxRestaurants: 1,
        maxBranchesPerRestaurant: 5,
        maxEmployeesPerRestaurant: 5,
      },
    });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/platform-admin/organizations/${organizationId}/subscription`)
      .set('Authorization', `Bearer ${paToken}`)
      .send({ planId: tinyPlan.id })
      .expect(403);
    expect(response.body.code).toBe('SUBSCRIPTION_LIMIT_EXCEEDED');
  });

  // ---------------------------------------------------------------------
  // Owner/Admin read-only visibility (D23) - no :id, own org implicit from JWT
  // ---------------------------------------------------------------------

  it('Owner: reads own subscription and usage (no organizationId in the URL)', async () => {
    if (!dbAvailable || !app) return;
    const { token } = await seedOwner('owner-read');

    const subResponse = await request(app.getHttpServer())
      .get('/api/v1/organizations/subscription')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(subResponse.body.data.status).toBe('Active');

    const usageResponse = await request(app.getHttpServer())
      .get('/api/v1/organizations/subscription/usage')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(usageResponse.body.data.restaurantCount).toBe(0);
    expect(usageResponse.body.data.maxRestaurants).toBe(10);
  });

  // ---------------------------------------------------------------------
  // Authorization matrix - Employee/Customer denial (D23/D24), PlatformAdmin-only writes (D9)
  // ---------------------------------------------------------------------

  it('rejects an unauthenticated request to the PlatformAdmin subscription routes', async () => {
    if (!dbAvailable || !app) return;
    const response = await request(app.getHttpServer()).get('/api/v1/platform-admin/plans');
    expect(response.status).toBe(403);
  });

  it('rejects a real Restaurant Owner token on the PlatformAdmin routes (never combined guard chains)', async () => {
    if (!dbAvailable || !app) return;
    const { token, organizationId } = await seedOwner('owner-on-pa-route');

    const response = await request(app.getHttpServer())
      .get(`/api/v1/platform-admin/organizations/${organizationId}/subscription`)
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(403);
  });

  it('rejects an unauthenticated request to the Owner subscription routes', async () => {
    if (!dbAvailable || !app) return;
    const response = await request(app.getHttpServer()).get('/api/v1/organizations/subscription');
    expect(response.status).toBe(401);
  });

  // ---------------------------------------------------------------------
  // End-to-end enforcement: maxRestaurants actually blocks creation via the real API
  // ---------------------------------------------------------------------

  it('blocks Restaurant creation once maxRestaurants is reached, real API end-to-end', async () => {
    if (!dbAvailable || !app) return;
    const paToken = await seedPlatformAdmin('limit-enforce');
    const { organizationId, token: ownerToken } = await seedOwner('limit-enforce');

    const onePlan = await prisma.subscriptionPlan.create({
      data: {
        name: `${TEST_PREFIX}One Restaurant Plan ${uniqueId()}`,
        slug: `${TEST_PREFIX}one-restaurant-${uniqueId()}`,
        maxRestaurants: 1,
        maxBranchesPerRestaurant: 5,
        maxEmployeesPerRestaurant: 5,
      },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/platform-admin/organizations/${organizationId}/subscription`)
      .set('Authorization', `Bearer ${paToken}`)
      .send({ planId: onePlan.id })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `${TEST_PREFIX}First Restaurant ${uniqueId()}` })
      .expect(201);

    const secondAttempt = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `${TEST_PREFIX}Second Restaurant ${uniqueId()}` });

    expect(secondAttempt.status).toBe(403);
    expect(secondAttempt.body.code).toBe('SUBSCRIPTION_LIMIT_EXCEEDED');

    const restaurantCount = await prisma.restaurant.count({
      where: { organizationId, deletedAt: null },
    });
    expect(restaurantCount).toBe(1);
  });
});
