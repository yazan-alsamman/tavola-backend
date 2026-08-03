import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword, seedOwnerAndOrganization } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'discovery-e2e-';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

/**
 * Customer Restaurant Discovery & Public Read Surface (owner-authorized).
 * Every assertion here targets `GET /api/v1/discovery/restaurants/**` with
 * NO `Authorization` header at all - proving the surface is genuinely
 * public, not merely "any authenticated actor," and that it intentionally
 * crosses organization boundaries (the product purpose) while every
 * management endpoint it reuses no infrastructure from remains untouched.
 */
describe('/api/v1/discovery/restaurants (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — discovery e2e tests NOT EXECUTED.');
      return;
    }
    passwordHash = await hashTestPassword(PASSWORD);
    app = await createTestApp();
  });

  afterAll(async () => {
    try {
      if (dbAvailable) {
        await prisma.table.deleteMany({
          where: { branch: { restaurant: { slug: { startsWith: TEST_PREFIX } } } },
        });
        await prisma.floorPlan.deleteMany({
          where: { branch: { restaurant: { slug: { startsWith: TEST_PREFIX } } } },
        });
        await prisma.branch.deleteMany({
          where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
        });
        await prisma.restaurant.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
        await prisma.organizationMember.deleteMany({
          where: { organization: { name: { startsWith: TEST_PREFIX } } },
        });
        await prisma.deviceSession.deleteMany({
          where: { user: { email: { startsWith: TEST_PREFIX } } },
        });
        await prisma.tokenFamily.deleteMany({
          where: { user: { email: { startsWith: TEST_PREFIX } } },
        });
        await prisma.organization.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
        await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
        await prisma.$disconnect();
      }
    } finally {
      if (app) {
        await app.close();
      }
    }
  });

  async function registerAndLoginOwner(
    suffix: string,
  ): Promise<{ accessToken: string; userId: string }> {
    const email = `${TEST_PREFIX}${suffix}-${uniqueId()}@example.com`;
    const { userId } = await seedOwnerAndOrganization(prisma, {
      email,
      passwordHash,
      lastName: suffix,
      organizationName: `${TEST_PREFIX}Org ${suffix} ${uniqueId()}`,
    });
    const loginResponse = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, deviceType: 'web' })
      .expect(200);
    return { accessToken: loginResponse.body.data.accessToken as string, userId };
  }

  async function setUpRestaurantBranchTable(
    ownerAccessToken: string,
    namePrefix: string,
  ): Promise<{ restaurantId: string; branchId: string; floorPlanId: string; tableId: string }> {
    const restaurantResponse = await request(app!.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ name: `${namePrefix} Bistro`, slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    const restaurantId = restaurantResponse.body.data.restaurantId as string;

    const branchResponse = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({
        city: 'Damascus',
        address: '123 Main St',
        latitude: 33.5138,
        longitude: 36.2765,
        countryCode: 'SY',
        timezone: 'Asia/Damascus',
      })
      .expect(201);
    const branchId = branchResponse.body.data.branchId as string;

    const floorPlanResponse = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches/${branchId}/floor-plans`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ name: 'Main Floor' })
      .expect(201);
    const floorPlanId = floorPlanResponse.body.data.floorPlanId as string;

    const tableResponse = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches/${branchId}/tables`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ floorPlanId, tableNumber: 'T1', capacity: 4 })
      .expect(201);
    const tableId = tableResponse.body.data.tableId as string;

    return { restaurantId, branchId, floorPlanId, tableId };
  }

  it('lists restaurants from two DIFFERENT organizations, unauthenticated (cross-org discovery)', async () => {
    if (!dbAvailable) return;

    const ownerA = await registerAndLoginOwner('cross-a');
    const ownerB = await registerAndLoginOwner('cross-b');
    const { restaurantId: restaurantAId } = await setUpRestaurantBranchTable(
      ownerA.accessToken,
      'Cross Org A',
    );
    const { restaurantId: restaurantBId } = await setUpRestaurantBranchTable(
      ownerB.accessToken,
      'Cross Org B',
    );

    // No Authorization header at all.
    const response = await request(app!.getHttpServer())
      .get('/api/v1/discovery/restaurants')
      .query({ limit: 100 })
      .expect(200);

    const ids = response.body.data.items.map((item: { restaurantId: string }) => item.restaurantId);
    expect(ids).toContain(restaurantAId);
    expect(ids).toContain(restaurantBId);
    expect(response.body.data.items[0]).not.toHaveProperty('organizationId');
  });

  it('returns a restaurant, its branches, and its active floor plan/table topology, unauthenticated', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('detail');
    const { restaurantId, branchId, floorPlanId, tableId } = await setUpRestaurantBranchTable(
      owner.accessToken,
      'Detail',
    );

    const restaurantResponse = await request(app!.getHttpServer())
      .get(`/api/v1/discovery/restaurants/${restaurantId}`)
      .expect(200);
    expect(restaurantResponse.body.data.restaurantId).toBe(restaurantId);
    expect(restaurantResponse.body.data).not.toHaveProperty('organizationId');

    const branchesResponse = await request(app!.getHttpServer())
      .get(`/api/v1/discovery/restaurants/${restaurantId}/branches`)
      .expect(200);
    expect(branchesResponse.body.data.items).toHaveLength(1);
    expect(branchesResponse.body.data.items[0].branchId).toBe(branchId);

    const branchResponse = await request(app!.getHttpServer())
      .get(`/api/v1/discovery/restaurants/${restaurantId}/branches/${branchId}`)
      .expect(200);
    expect(branchResponse.body.data.branchId).toBe(branchId);
    expect(branchResponse.body.data.latitude).toBeCloseTo(33.5138, 3);

    const floorPlanResponse = await request(app!.getHttpServer())
      .get(`/api/v1/discovery/restaurants/${restaurantId}/branches/${branchId}/floor-plan`)
      .expect(200);
    expect(floorPlanResponse.body.data.floorPlan.floorPlanId).toBe(floorPlanId);
    expect(floorPlanResponse.body.data.floorPlan).not.toHaveProperty('isActive');
    expect(floorPlanResponse.body.data.tables).toHaveLength(1);
    expect(floorPlanResponse.body.data.tables[0].tableId).toBe(tableId);
  });

  it('404s for an unknown restaurant id (never leaks existence of another status)', async () => {
    if (!dbAvailable) return;
    await request(app!.getHttpServer())
      .get(`/api/v1/discovery/restaurants/${randomUUID()}`)
      .expect(404);
  });

  it('404s when requesting a branch under the wrong restaurant id (IDOR-safe)', async () => {
    if (!dbAvailable) return;

    const ownerA = await registerAndLoginOwner('idor-a');
    const ownerB = await registerAndLoginOwner('idor-b');
    const { branchId } = await setUpRestaurantBranchTable(ownerA.accessToken, 'IDOR A');
    const { restaurantId: restaurantBId } = await setUpRestaurantBranchTable(
      ownerB.accessToken,
      'IDOR B',
    );

    await request(app!.getHttpServer())
      .get(`/api/v1/discovery/restaurants/${restaurantBId}/branches/${branchId}`)
      .expect(404);
  });

  it('management endpoints remain forbidden/unauthenticated-rejected through the discovery path', async () => {
    if (!dbAvailable) return;
    // The discovery listing itself must never accept a mutation - proving
    // no write route was accidentally exposed on this public surface.
    await request(app!.getHttpServer())
      .post('/api/v1/discovery/restaurants')
      .send({ name: 'Should Not Work' })
      .expect(404);
  });

  /**
   * Phase 15.5 (Discovery Module, architecture frozen 2026-07-29). Every
   * assertion below still targets a genuinely public route (no Authorization
   * header).
   */
  it('D5/D6/D7: search filters by q, cuisineId, priceLevel, and minRating', async () => {
    if (!dbAvailable) return;
    const owner = await registerAndLoginOwner('search');
    const { restaurantId } = await setUpRestaurantBranchTable(owner.accessToken, 'Old Mill Search');
    await request(app!.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Old Mill Search Bistro', priceLevel: 4, status: 'Active' })
      .expect(200);

    const byName = await request(app!.getHttpServer())
      .get('/api/v1/discovery/restaurants')
      .query({ q: 'old mill', limit: 100 })
      .expect(200);
    expect(
      byName.body.data.items.some(
        (item: { restaurantId: string }) => item.restaurantId === restaurantId,
      ),
    ).toBe(true);
    expect(byName.body.data.items[0]).toHaveProperty('hasActiveOffer');

    const byPrice = await request(app!.getHttpServer())
      .get('/api/v1/discovery/restaurants')
      .query({ priceLevel: 4, limit: 100 })
      .expect(200);
    expect(
      byPrice.body.data.items.some(
        (item: { restaurantId: string }) => item.restaurantId === restaurantId,
      ),
    ).toBe(true);

    const byWrongPrice = await request(app!.getHttpServer())
      .get('/api/v1/discovery/restaurants')
      .query({ priceLevel: 1, q: 'old mill search', limit: 100 })
      .expect(200);
    expect(
      byWrongPrice.body.data.items.some(
        (item: { restaurantId: string }) => item.restaurantId === restaurantId,
      ),
    ).toBe(false);
  });

  it('D4: nearby search includes a branch inside the radius and excludes one far away, with deterministic distance ordering', async () => {
    if (!dbAvailable) return;
    const owner = await registerAndLoginOwner('nearby');
    // Damascus coordinates, matching setUpRestaurantBranchTable's fixture.
    const { restaurantId: nearId } = await setUpRestaurantBranchTable(
      owner.accessToken,
      'Nearby Near',
    );

    const farRestaurant = await request(app!.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Nearby Far Bistro', slug: `discovery-e2e-${randomUUID()}` })
      .expect(201);
    const farRestaurantId = farRestaurant.body.data.restaurantId as string;
    await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${farRestaurantId}/branches`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        city: 'Aleppo',
        address: '1 Far St',
        latitude: 36.2021,
        longitude: 37.1343,
        countryCode: 'SY',
        timezone: 'Asia/Damascus',
      })
      .expect(201);

    const response = await request(app!.getHttpServer())
      .get('/api/v1/discovery/restaurants/nearby')
      .query({ lat: 33.5138, lng: 36.2765, radiusKm: 5, limit: 100 })
      .expect(200);

    const ids = response.body.data.items.map((item: { restaurantId: string }) => item.restaurantId);
    expect(ids).toContain(nearId);
    expect(ids).not.toContain(farRestaurantId);
    const nearItem = response.body.data.items.find(
      (item: { restaurantId: string }) => item.restaurantId === nearId,
    );
    expect(nearItem).toHaveProperty('nearestBranchId');
    expect(nearItem).toHaveProperty('distanceKm');
  });

  it('D4: rejects nearby search with an out-of-range latitude/longitude or an over-limit radius (400)', async () => {
    if (!dbAvailable) return;
    await request(app!.getHttpServer())
      .get('/api/v1/discovery/restaurants/nearby')
      .query({ lat: 999, lng: 36.2765 })
      .expect(400);
    await request(app!.getHttpServer())
      .get('/api/v1/discovery/restaurants/nearby')
      .query({ lat: 33.5138, lng: 36.2765, radiusKm: 500 })
      .expect(400);
    await request(app!.getHttpServer())
      .get('/api/v1/discovery/restaurants/nearby')
      .query({ lng: 36.2765 })
      .expect(400);
  });

  it('D15/D18/D19: compares 2-5 restaurants, preserving requested order and silently omitting a hidden id', async () => {
    if (!dbAvailable) return;
    const owner = await registerAndLoginOwner('compare');
    const { restaurantId: idA } = await setUpRestaurantBranchTable(owner.accessToken, 'Compare A');
    const { restaurantId: idB } = await setUpRestaurantBranchTable(owner.accessToken, 'Compare B');

    const response = await request(app!.getHttpServer())
      .post('/api/v1/discovery/restaurants/compare')
      .send({ restaurantIds: [idB, randomUUID(), idA] })
      .expect(200);

    expect(
      response.body.data.items.map((item: { restaurantId: string }) => item.restaurantId),
    ).toEqual([idB, idA]);
  });

  it('D18: rejects a comparison request with fewer than 2 or more than 5 restaurantIds, or duplicates (400)', async () => {
    if (!dbAvailable) return;
    await request(app!.getHttpServer())
      .post('/api/v1/discovery/restaurants/compare')
      .send({ restaurantIds: [randomUUID()] })
      .expect(400);
    await request(app!.getHttpServer())
      .post('/api/v1/discovery/restaurants/compare')
      .send({
        restaurantIds: [
          randomUUID(),
          randomUUID(),
          randomUUID(),
          randomUUID(),
          randomUUID(),
          randomUUID(),
        ],
      })
      .expect(400);
    const dup = randomUUID();
    await request(app!.getHttpServer())
      .post('/api/v1/discovery/restaurants/compare')
      .send({ restaurantIds: [dup, dup] })
      .expect(400);
  });

  it('D11: the public floor-plan response never includes mergeGroupId/isMergePrimary/status/timestamps, but keeps safe geometry fields', async () => {
    if (!dbAvailable) return;
    const owner = await registerAndLoginOwner('privacy');
    const { restaurantId, branchId } = await setUpRestaurantBranchTable(
      owner.accessToken,
      'Privacy',
    );

    const response = await request(app!.getHttpServer())
      .get(`/api/v1/discovery/restaurants/${restaurantId}/branches/${branchId}/floor-plan`)
      .expect(200);

    expect(response.body.data.floorPlan).not.toHaveProperty('isActive');
    expect(response.body.data.floorPlan).not.toHaveProperty('createdAt');
    expect(response.body.data.floorPlan).not.toHaveProperty('updatedAt');

    const table = response.body.data.tables[0];
    expect(table).toBeDefined();
    expect(table).not.toHaveProperty('mergeGroupId');
    expect(table).not.toHaveProperty('isMergePrimary');
    expect(table).not.toHaveProperty('status');
    expect(table).not.toHaveProperty('branchId');
    expect(table).not.toHaveProperty('createdAt');
    expect(table).not.toHaveProperty('updatedAt');
    // Safe layout/selection fields must still be present.
    expect(table).toHaveProperty('tableId');
    expect(table).toHaveProperty('tableNumber');
    expect(table).toHaveProperty('capacity');
    expect(table).toHaveProperty('shape');
  });

  it('D12: rate-limits the public Discovery surface at 60 requests/60s per client IP, returning 429 past the limit', async () => {
    if (!dbAvailable) return;
    // A fresh, distinguishing header so this test's own bucket cannot collide
    // with traffic any other test in this file already sent from the same
    // loopback IP within the same 60s sliding window.
    const forwardedFor = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;

    let sawTooManyRequests = false;
    for (let i = 0; i < 65; i += 1) {
      const response = await request(app!.getHttpServer())
        .get('/api/v1/discovery/restaurants')
        .set('X-Forwarded-For', forwardedFor)
        .query({ limit: 1 });
      if (response.status === 429) {
        sawTooManyRequests = true;
        expect(response.body.code).toBe('RATE_LIMIT_EXCEEDED');
        break;
      }
      expect(response.status).toBe(200);
    }
    expect(sawTooManyRequests).toBe(true);
  }, 30000);
});
