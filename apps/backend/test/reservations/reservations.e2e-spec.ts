import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'reservation-e2e-';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

describe('/api/v1/reservations (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — reservations e2e tests NOT EXECUTED.');
      return;
    }
    app = await createTestApp();
  });

  afterAll(async () => {
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
    if (app) {
      await app.close();
    }
  });

  async function registerAndLoginOwner(
    suffix: string,
  ): Promise<{ accessToken: string; userId: string }> {
    const email = `${TEST_PREFIX}${suffix}-${uniqueId()}@example.com`;
    const registerResponse = await request(app!.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        intent: 'owner',
        email,
        password: PASSWORD,
        firstName: 'Owner',
        lastName: suffix,
        organizationName: `${TEST_PREFIX}Org ${suffix} ${uniqueId()}`,
        consents: { termsOfService: true, privacyPolicy: true },
      })
      .expect(201);
    const userId = registerResponse.body.data.userId as string;

    await prisma.user.update({
      where: { id: userId },
      data: { status: 'Active', emailVerified: true },
    });

    const loginResponse = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, deviceType: 'web' })
      .expect(200);

    return { accessToken: loginResponse.body.data.accessToken as string, userId };
  }

  async function setUpRestaurantBranchTable(
    ownerAccessToken: string,
  ): Promise<{ branchId: string; tableId: string }> {
    const restaurantResponse = await request(app!.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ name: 'The Old Mill', slug: `${TEST_PREFIX}${uniqueId()}` })
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

    return { branchId, tableId };
  }

  it('GET /reservations/availability returns the table, unmarked when nothing is reserved', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('avail');
    const { branchId } = await setUpRestaurantBranchTable(owner.accessToken);
    const customer = await registerAndLoginOwner('avail-customer');

    const response = await request(app!.getHttpServer())
      .get('/api/v1/reservations/availability')
      .query({
        branchId,
        reservationStartTime: '2026-09-10T18:00:00.000Z',
        partySize: 2,
      })
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].isAvailable).toBe(true);
  });

  it('POST /reservations creates a Pending reservation and derives reservationEndTime when omitted', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('create');
    const { branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const customer = await registerAndLoginOwner('create-customer');

    const response = await request(app!.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({
        branchId,
        tableId,
        reservationStartTime: '2026-09-11T18:00:00.000Z',
        guests: 2,
      })
      .expect(201);

    expect(response.body.data.status).toBe('Pending');
    expect(response.body.data.userId).toBe(customer.userId);
    // RestaurantSettings default is 90 minutes.
    expect(response.body.data.reservationEndTime).toBe('2026-09-11T19:30:00.000Z');

    const row = await prisma.reservation.findUnique({
      where: { id: response.body.data.reservationId },
    });
    expect(row?.status).toBe('Pending');

    const auditRow = await prisma.auditLog.findFirst({
      where: { targetId: response.body.data.reservationId, action: 'reservation.created' },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.actorId).toBe(customer.userId);
  });

  it('POST /reservations validates and persists a client-supplied reservationEndTime', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('client-end');
    const { branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const customer = await registerAndLoginOwner('client-end-customer');

    const response = await request(app!.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({
        branchId,
        tableId,
        reservationStartTime: '2026-09-12T18:00:00.000Z',
        reservationEndTime: '2026-09-12T20:00:00.000Z',
        guests: 2,
      })
      .expect(201);

    expect(response.body.data.reservationEndTime).toBe('2026-09-12T20:00:00.000Z');
  });

  it('rejects reservationEndTime at or before reservationStartTime', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('bad-end');
    const { branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const customer = await registerAndLoginOwner('bad-end-customer');

    const response = await request(app!.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({
        branchId,
        tableId,
        reservationStartTime: '2026-09-13T18:00:00.000Z',
        reservationEndTime: '2026-09-13T17:00:00.000Z',
        guests: 2,
      })
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects party size exceeding the table capacity', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('capacity');
    const { branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const customer = await registerAndLoginOwner('capacity-customer');

    const response = await request(app!.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({
        branchId,
        tableId,
        reservationStartTime: '2026-09-14T18:00:00.000Z',
        guests: 99,
      })
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('allows two overlapping Pending reservations for the same table, and marks it unavailable in search', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('pending-coexist');
    const { branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const customerA = await registerAndLoginOwner('pending-coexist-a');
    const customerB = await registerAndLoginOwner('pending-coexist-b');

    await request(app!.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${customerA.accessToken}`)
      .send({
        branchId,
        tableId,
        reservationStartTime: '2026-09-15T18:00:00.000Z',
        reservationEndTime: '2026-09-15T19:30:00.000Z',
        guests: 2,
      })
      .expect(201);

    await request(app!.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${customerB.accessToken}`)
      .send({
        branchId,
        tableId,
        reservationStartTime: '2026-09-15T18:30:00.000Z',
        reservationEndTime: '2026-09-15T20:00:00.000Z',
        guests: 2,
      })
      .expect(201);

    const availabilityResponse = await request(app!.getHttpServer())
      .get('/api/v1/reservations/availability')
      .query({
        branchId,
        reservationStartTime: '2026-09-15T18:15:00.000Z',
        reservationEndTime: '2026-09-15T18:45:00.000Z',
        partySize: 2,
      })
      .set('Authorization', `Bearer ${customerA.accessToken}`)
      .expect(200);

    expect(availabilityResponse.body.data).toHaveLength(1);
    expect(availabilityResponse.body.data[0].tableId).toBe(tableId);
    expect(availabilityResponse.body.data[0].isAvailable).toBe(false);
  });

  it('returns 404 when the table belongs to a different branch (IDOR)', async () => {
    if (!dbAvailable) return;

    const ownerA = await registerAndLoginOwner('idor-a');
    const { tableId } = await setUpRestaurantBranchTable(ownerA.accessToken);
    const ownerB = await registerAndLoginOwner('idor-b');
    const { branchId: branchB } = await setUpRestaurantBranchTable(ownerB.accessToken);
    const customer = await registerAndLoginOwner('idor-customer');

    const response = await request(app!.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({
        branchId: branchB,
        tableId,
        reservationStartTime: '2026-09-16T18:00:00.000Z',
        guests: 2,
      })
      .expect(404);

    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('returns 401 without a token', async () => {
    if (!dbAvailable) return;

    await request(app!.getHttpServer())
      .get('/api/v1/reservations/availability')
      .query({
        branchId: randomUUID(),
        reservationStartTime: '2026-09-17T18:00:00.000Z',
        partySize: 2,
      })
      .expect(401);
  });
});
