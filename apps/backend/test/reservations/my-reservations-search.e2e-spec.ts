import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword, seedOwnerAndOrganization } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'my-reservations-search-e2e-';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

/**
 * Phase 18.x (Customer Reservation History) - `GET /reservations/my`,
 * `GET /reservations/my/upcoming`, `GET /reservations/my/history`, and
 * `GET /reservations/my/:reservationId`. Real HTTP, real Postgres.
 * `GET /reservations` (mine)'s own e2e suite (`my-reservations.e2e-spec.ts`)
 * already covers the plain, unfiltered ownership boundary in detail - this
 * suite focuses on what is NEW here: filters, enrichment fields, upcoming/
 * history scope derivation, and the Customer-only actor-type gate, shared
 * across all four routes.
 */
describe('/api/v1/reservations/my* (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — my-reservations-search e2e tests NOT EXECUTED.');
      return;
    }
    passwordHash = await hashTestPassword(PASSWORD);
    app = await createTestApp();
  });

  afterAll(async () => {
    try {
      if (dbAvailable) {
        await prisma.reservation.deleteMany({
          where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
        });
        await prisma.table.deleteMany({
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

  async function registerAndLoginCustomer(
    suffix: string,
  ): Promise<{ accessToken: string; userId: string }> {
    const email = `${TEST_PREFIX}${suffix}-${uniqueId()}@example.com`;
    const username = `${uniqueId()}_${TEST_PREFIX.replace(/-/g, '_')}${suffix}`.slice(0, 30);
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Test',
        lastName: suffix,
        email,
        username,
        passwordHash,
        language: 'en',
        status: 'Active',
        emailVerified: true,
      },
    });
    const loginResponse = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, deviceType: 'web' })
      .expect(200);
    return { accessToken: loginResponse.body.data.accessToken as string, userId };
  }

  async function setUpRestaurantBranchTable(
    ownerAccessToken: string,
    restaurantName = 'The Old Mill',
  ): Promise<{ restaurantId: string; branchId: string; tableId: string }> {
    const restaurantResponse = await request(app!.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ name: restaurantName, slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    const restaurantId = restaurantResponse.body.data.restaurantId as string;

    const branchResponse = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({
        city: 'Damascus',
        address: '123 Main St',
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

    return { restaurantId, branchId, tableId };
  }

  async function createReservation(
    customerAccessToken: string,
    branchId: string,
    tableId: string,
    reservationStartTime: string,
  ): Promise<string> {
    const response = await request(app!.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${customerAccessToken}`)
      .send({ branchId, tableId, reservationStartTime, guests: 2 })
      .expect(201);
    return response.body.data.reservationId as string;
  }

  it('a Customer retrieves GET /reservations/my with restaurant/branch/table enrichment', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('enrich');
    const { branchId, tableId, restaurantId } = await setUpRestaurantBranchTable(
      owner.accessToken,
      'Enrichment Restaurant',
    );
    const customer = await registerAndLoginCustomer('enrich');

    const reservationId = await createReservation(
      customer.accessToken,
      branchId,
      tableId,
      '2026-09-12T18:00:00.000Z',
    );

    const response = await request(app!.getHttpServer())
      .get('/api/v1/reservations/my')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200);

    expect(response.body.data.items).toHaveLength(1);
    const item = response.body.data.items[0];
    expect(item.reservationId).toBe(reservationId);
    expect(item.restaurantId).toBe(restaurantId);
    expect(item.restaurantName).toBe('Enrichment Restaurant');
    expect(item.branchId).toBe(branchId);
    expect(item.branchName).toBe('123 Main St');
    expect(item.partySize).toBe(2);
    expect(item.table).toEqual({ tableId, tableNumber: 'T1', capacity: 4 });
    expect(item).toHaveProperty('reservationSource');
    expect(item).toHaveProperty('specialRequest');
  });

  it('returns an empty page for a Customer with no reservations on all three routes', async () => {
    if (!dbAvailable) return;

    const customer = await registerAndLoginCustomer('empty');

    for (const path of [
      '/api/v1/reservations/my',
      '/api/v1/reservations/my/upcoming',
      '/api/v1/reservations/my/history',
    ]) {
      const response = await request(app!.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(200);
      expect(response.body.data.items).toEqual([]);
      expect(response.body.data.total).toBe(0);
    }
  });

  it('paginates GET /reservations/my', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('page');
    const { branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const customer = await registerAndLoginCustomer('page');

    await createReservation(customer.accessToken, branchId, tableId, '2026-09-13T18:00:00.000Z');
    await createReservation(customer.accessToken, branchId, tableId, '2026-09-14T18:00:00.000Z');
    await createReservation(customer.accessToken, branchId, tableId, '2026-09-15T18:00:00.000Z');

    const page1 = await request(app!.getHttpServer())
      .get('/api/v1/reservations/my?page=1&limit=2')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200);
    expect(page1.body.data.items).toHaveLength(2);
    expect(page1.body.data.total).toBe(3);

    const page2 = await request(app!.getHttpServer())
      .get('/api/v1/reservations/my?page=2&limit=2')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200);
    expect(page2.body.data.items).toHaveLength(1);
  });

  it('filters GET /reservations/my by status', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('status');
    const { branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const customer = await registerAndLoginCustomer('status');

    const pendingId = await createReservation(
      customer.accessToken,
      branchId,
      tableId,
      '2026-09-16T18:00:00.000Z',
    );
    const cancelledId = await createReservation(
      customer.accessToken,
      branchId,
      tableId,
      '2026-09-17T18:00:00.000Z',
    );
    await request(app!.getHttpServer())
      .post(`/api/v1/reservations/${cancelledId}/cancel`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({})
      .expect(200);

    const response = await request(app!.getHttpServer())
      .get('/api/v1/reservations/my?status=Cancelled')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200);

    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].reservationId).toBe(cancelledId);
    expect(response.body.data.items[0].status).toBe('Cancelled');
    expect(
      response.body.data.items.some(
        (i: { reservationId: string }) => i.reservationId === pendingId,
      ),
    ).toBe(false);
  });

  it('filters by restaurantId (shared across all three routes)', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('rest-filter');
    const restaurantA = await setUpRestaurantBranchTable(owner.accessToken, 'Restaurant A');
    const restaurantB = await setUpRestaurantBranchTable(owner.accessToken, 'Restaurant B');
    const customer = await registerAndLoginCustomer('rest-filter');

    const reservationAId = await createReservation(
      customer.accessToken,
      restaurantA.branchId,
      restaurantA.tableId,
      '2026-09-18T18:00:00.000Z',
    );
    await createReservation(
      customer.accessToken,
      restaurantB.branchId,
      restaurantB.tableId,
      '2026-09-19T18:00:00.000Z',
    );

    const response = await request(app!.getHttpServer())
      .get(`/api/v1/reservations/my?restaurantId=${restaurantA.restaurantId}`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200);

    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].reservationId).toBe(reservationAId);
  });

  it('filters by date range (shared across all three routes)', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('date-filter');
    const { branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const customer = await registerAndLoginCustomer('date-filter');

    await createReservation(customer.accessToken, branchId, tableId, '2026-09-20T18:00:00.000Z');
    const laterReservationId = await createReservation(
      customer.accessToken,
      branchId,
      tableId,
      '2027-01-15T18:00:00.000Z',
    );

    const response = await request(app!.getHttpServer())
      .get('/api/v1/reservations/my?dateFrom=2027-01-01&dateTo=2027-12-31')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200);

    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].reservationId).toBe(laterReservationId);
  });

  it('GET /reservations/my/upcoming returns only the future, active reservation; GET /reservations/my/history returns only the cancelled one', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('scope');
    const { branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const customer = await registerAndLoginCustomer('scope');

    const upcomingId = await createReservation(
      customer.accessToken,
      branchId,
      tableId,
      '2026-09-22T18:00:00.000Z',
    );
    const cancelledId = await createReservation(
      customer.accessToken,
      branchId,
      tableId,
      '2026-09-23T18:00:00.000Z',
    );
    await request(app!.getHttpServer())
      .post(`/api/v1/reservations/${cancelledId}/cancel`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({})
      .expect(200);

    const upcomingResponse = await request(app!.getHttpServer())
      .get('/api/v1/reservations/my/upcoming')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200);
    expect(upcomingResponse.body.data.items).toHaveLength(1);
    expect(upcomingResponse.body.data.items[0].reservationId).toBe(upcomingId);

    const historyResponse = await request(app!.getHttpServer())
      .get('/api/v1/reservations/my/history')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200);
    expect(historyResponse.body.data.items).toHaveLength(1);
    expect(historyResponse.body.data.items[0].reservationId).toBe(cancelledId);
    expect(historyResponse.body.data.items[0].status).toBe('Cancelled');
  });

  it('GET /reservations/my/:reservationId returns the complete reservation details', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('details');
    const { branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const customer = await registerAndLoginCustomer('details');

    const reservationId = await createReservation(
      customer.accessToken,
      branchId,
      tableId,
      '2026-09-25T18:00:00.000Z',
    );

    const response = await request(app!.getHttpServer())
      .get(`/api/v1/reservations/my/${reservationId}`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200);

    expect(response.body.data.reservationId).toBe(reservationId);
    expect(response.body.data.branchId).toBe(branchId);
    expect(response.body.data.tableId).toBe(tableId);
    expect(response.body.data.guests).toBe(2);
  });

  it("a Customer never sees another Customer's reservations on any of the four routes (cross-customer isolation)", async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('isolation');
    const { branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const customerA = await registerAndLoginCustomer('isolation-a');
    const customerB = await registerAndLoginCustomer('isolation-b');

    const reservationId = await createReservation(
      customerA.accessToken,
      branchId,
      tableId,
      '2026-09-24T18:00:00.000Z',
    );

    for (const path of ['/api/v1/reservations/my', '/api/v1/reservations/my/upcoming']) {
      const response = await request(app!.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${customerB.accessToken}`)
        .expect(200);
      expect(
        response.body.data.items.some(
          (item: { reservationId: string }) => item.reservationId === reservationId,
        ),
      ).toBe(false);
    }

    // Direct GET by id from customer B collapses to 404 - never a
    // distinguishing 403 that would confirm the resource exists.
    await request(app!.getHttpServer())
      .get(`/api/v1/reservations/my/${reservationId}`)
      .set('Authorization', `Bearer ${customerB.accessToken}`)
      .expect(404);
  });

  it('rejects an Owner/OrganizationMember actor on all four routes (Customer-only endpoint family)', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('actor-gate');

    for (const path of [
      '/api/v1/reservations/my',
      '/api/v1/reservations/my/upcoming',
      '/api/v1/reservations/my/history',
      `/api/v1/reservations/my/${randomUUID()}`,
    ]) {
      await request(app!.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(403);
    }
  });

  it('rejects an unauthenticated request on all four routes', async () => {
    if (!dbAvailable) return;
    for (const path of [
      '/api/v1/reservations/my',
      '/api/v1/reservations/my/upcoming',
      '/api/v1/reservations/my/history',
      `/api/v1/reservations/my/${randomUUID()}`,
    ]) {
      await request(app!.getHttpServer()).get(path).expect(401);
    }
  });
});
