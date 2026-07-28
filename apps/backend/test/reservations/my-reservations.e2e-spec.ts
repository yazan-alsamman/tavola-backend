import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword, seedOwnerAndOrganization } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'my-reservations-e2e-';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

/**
 * Customer Restaurant Discovery & Public Read Surface (Reservation privacy
 * boundary): `GET /reservations` (mine) and `GET /reservations/:id` (mine).
 * Proves a Customer sees only their own reservations and never another
 * Customer's - real HTTP, real Postgres.
 */
describe('/api/v1/reservations (mine, e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — my-reservations e2e tests NOT EXECUTED.');
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

  /** Bare `User` (Customer) row - a genuinely distinct actor from any Owner/Admin. */
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

  it('a Customer sees their own reservation in GET /reservations (mine) and GET /reservations/:id', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('mine');
    const { branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const customer = await registerAndLoginCustomer('mine');

    const createResponse = await request(app!.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ branchId, tableId, reservationStartTime: '2026-09-12T18:00:00.000Z', guests: 2 })
      .expect(201);
    const reservationId = createResponse.body.data.reservationId as string;

    const listResponse = await request(app!.getHttpServer())
      .get('/api/v1/reservations')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200);
    expect(listResponse.body.data.items).toHaveLength(1);
    expect(listResponse.body.data.items[0].reservationId).toBe(reservationId);

    const getResponse = await request(app!.getHttpServer())
      .get(`/api/v1/reservations/${reservationId}`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200);
    expect(getResponse.body.data.reservationId).toBe(reservationId);
  });

  it('a Customer CANNOT see another Customer’s reservation (privacy boundary, IDOR-safe 404)', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('privacy');
    const { branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const customerA = await registerAndLoginCustomer('privacy-a');
    const customerB = await registerAndLoginCustomer('privacy-b');

    const createResponse = await request(app!.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${customerA.accessToken}`)
      .send({ branchId, tableId, reservationStartTime: '2026-09-13T18:00:00.000Z', guests: 2 })
      .expect(201);
    const reservationId = createResponse.body.data.reservationId as string;

    // Customer B's own list never contains Customer A's reservation.
    const listResponse = await request(app!.getHttpServer())
      .get('/api/v1/reservations')
      .set('Authorization', `Bearer ${customerB.accessToken}`)
      .expect(200);
    expect(
      listResponse.body.data.items.some(
        (item: { reservationId: string }) => item.reservationId === reservationId,
      ),
    ).toBe(false);

    // Direct GET by id from Customer B collapses to 404 - never a
    // distinguishing 403 that would confirm the resource exists.
    await request(app!.getHttpServer())
      .get(`/api/v1/reservations/${reservationId}`)
      .set('Authorization', `Bearer ${customerB.accessToken}`)
      .expect(404);
  });

  it('rejects an unauthenticated request to GET /reservations', async () => {
    if (!dbAvailable) return;
    await request(app!.getHttpServer()).get('/api/v1/reservations').expect(401);
  });
});
