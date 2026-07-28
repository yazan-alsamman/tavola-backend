import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, RoleScope } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword, seedOwnerAndOrganization } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'reviews-e2e-';
const PASSWORD = 'SecurePass123!';
const validJpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

/**
 * Phase 10 (Reviews, architecture frozen 2026-07-26) full e2e coverage:
 * Submit/Delete/Reply/Images across the complete frozen API surface, against
 * a real Postgres-backed running application.
 */
describe('/api/v1/reviews (e2e, Phase 10)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let managerRoleId: string;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — reviews e2e tests NOT EXECUTED.');
      return;
    }
    passwordHash = await hashTestPassword(PASSWORD);
    app = await createTestApp();

    const manager = await prisma.role.upsert({
      where: { slug: 'manager' },
      update: {},
      create: {
        name: 'Restaurant Manager',
        slug: 'manager',
        description: 'Full restaurant operational access within assigned scope',
        scope: RoleScope.Restaurant,
      },
    });
    managerRoleId = manager.id;
  });

  afterAll(async () => {
    // `app.close()` must run even if cleanup below throws, or the live
    // NestJS app (HTTP server, BullMQ workers, DB/Redis connections) is
    // never torn down and the process hangs after the suite finishes -
    // Jest won't force-exit under --detectOpenHandles. See root-cause notes
    // on the reservation-history ordering below for why cleanup used to throw.
    try {
      if (dbAvailable) {
        await prisma.restaurantReply.deleteMany({
          where: { review: { restaurant: { slug: { startsWith: TEST_PREFIX } } } },
        });
        await prisma.reviewImage.deleteMany({
          where: { review: { restaurant: { slug: { startsWith: TEST_PREFIX } } } },
        });
        await prisma.review.deleteMany({
          where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
        });
        // Must precede the `reservation` delete below: ReservationHistory ->
        // Reservation is `onDelete: Restrict` (intentional in production -
        // history rows must outlive their reservation), so leftover history
        // rows from this suite's Complete-reservation lifecycle otherwise
        // make the next statement throw a FK violation every run.
        await prisma.reservationHistory.deleteMany({
          where: { reservation: { restaurant: { slug: { startsWith: TEST_PREFIX } } } },
        });
        await prisma.reservation.deleteMany({
          where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
        });
        await prisma.employeeBranchAssignment.deleteMany({
          where: { employee: { restaurant: { slug: { startsWith: TEST_PREFIX } } } },
        });
        await prisma.employee.deleteMany({
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
  ): Promise<{ accessToken: string; userId: string; email: string }> {
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
    return { accessToken: loginResponse.body.data.accessToken as string, userId, email };
  }

  /** Bare `User` (Customer) row - real username set (owner decision #14). */
  async function registerAndLoginCustomer(
    suffix: string,
  ): Promise<{ accessToken: string; userId: string; email: string; username: string }> {
    const email = `${TEST_PREFIX}${suffix}-${uniqueId()}@example.com`;
    // uniqueId() must survive truncation or repeat runs collide on the
    // `users_username_key` unique constraint against leftover/undeleted
    // rows from a prior run - it goes first, the readable suffix is what
    // gets clipped to fit the 30-char budget.
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
    return { accessToken: loginResponse.body.data.accessToken as string, userId, email, username };
  }

  async function setUpRestaurantBranchTable(
    ownerAccessToken: string,
  ): Promise<{ restaurantId: string; branchId: string; tableId: string }> {
    const restaurantResponse = await request(app!.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ name: 'The Review Bistro', slug: `${TEST_PREFIX}${uniqueId()}` })
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

  async function inviteAndLoginEmployee(
    ownerAccessToken: string,
    restaurantId: string,
  ): Promise<{ accessToken: string; employeeId: string }> {
    const person = await registerAndLoginOwner(`emp-${uniqueId()}`);
    const invited = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/employees`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ roleId: managerRoleId, firstName: 'Emma', lastName: 'Ployee', email: person.email })
      .expect(201);
    const employeeId = invited.body.data.employeeId as string;

    const loginResponse = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: person.email, password: PASSWORD, deviceType: 'web' })
      .expect(200);
    return { accessToken: loginResponse.body.data.accessToken as string, employeeId };
  }

  let reservationHour = 0;
  /** Creates a real Completed reservation via the actual HTTP lifecycle
   *  (Create -> Approve -> backdate -> Complete), never a shortcut insert -
   *  proves Review eligibility against the real Reservation state machine. */
  async function createCompletedReservation(
    customerAccessToken: string,
    employeeAccessToken: string,
    branchId: string,
    tableId: string,
  ): Promise<string> {
    reservationHour += 1;
    const startTime = `2026-12-01T${String(10 + (reservationHour % 10)).padStart(2, '0')}:00:00.000Z`;
    const createResponse = await request(app!.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${customerAccessToken}`)
      .send({ branchId, tableId, reservationStartTime: startTime, guests: 2 })
      .expect(201);
    const reservationId = createResponse.body.data.reservationId as string;

    await request(app!.getHttpServer())
      .post(`/api/v1/reservations/${reservationId}/approve`)
      .set('Authorization', `Bearer ${employeeAccessToken}`)
      .expect(200);

    // Staggered by reservationHour (65 min apart) so that two Completed
    // reservations backdated for the *same* table within one test - e.g.
    // the delete test's customerA/customerB pair - never land in
    // overlapping windows and trip `reservations_no_overlapping_confirmed_excl`.
    const backdateOffsetMs = reservationHour * 65 * 60_000;
    await prisma.reservation.update({
      where: { id: reservationId },
      data: {
        reservationStartTime: new Date(Date.now() - backdateOffsetMs - 5 * 60_000),
        reservationEndTime: new Date(Date.now() - backdateOffsetMs + 55 * 60_000),
      },
    });

    await request(app!.getHttpServer())
      .post(`/api/v1/reservations/${reservationId}/complete`)
      .set('Authorization', `Bearer ${employeeAccessToken}`)
      .expect(200);

    return reservationId;
  }

  it('Customer submits a review for their own Completed reservation, with rating and comment', async () => {
    if (!dbAvailable) return;
    const owner = await registerAndLoginOwner('submit-owner');
    const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);
    const customer = await registerAndLoginCustomer('submit-customer');
    const reservationId = await createCompletedReservation(
      customer.accessToken,
      employee.accessToken,
      branchId,
      tableId,
    );

    const response = await request(app!.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ reservationId, rating: 5, comment: 'Wonderful evening!' })
      .expect(201);

    expect(response.body.data.rating).toBe(5);
    expect(response.body.data.comment).toBe('Wonderful evening!');
    expect(response.body.data.reviewerUsername).toBe(customer.username);
    expect(response.body.data).not.toHaveProperty('userId');
  });

  it('rejects an invalid rating (out of 1-5 range)', async () => {
    if (!dbAvailable) return;
    const owner = await registerAndLoginOwner('invalid-rating-owner');
    const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);
    const customer = await registerAndLoginCustomer('invalid-rating-customer');
    const reservationId = await createCompletedReservation(
      customer.accessToken,
      employee.accessToken,
      branchId,
      tableId,
    );

    await request(app!.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ reservationId, rating: 6 })
      .expect(400);
  });

  it('rejects submitting a review for a non-Completed reservation', async () => {
    if (!dbAvailable) return;
    const owner = await registerAndLoginOwner('pending-owner');
    const { branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const customer = await registerAndLoginCustomer('pending-customer');
    const createResponse = await request(app!.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ branchId, tableId, reservationStartTime: '2026-12-05T18:00:00.000Z', guests: 2 })
      .expect(201);

    await request(app!.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ reservationId: createResponse.body.data.reservationId, rating: 5 })
      .expect(400);
  });

  it("rejects submitting a review for another Customer's reservation (404 IDOR-safe)", async () => {
    if (!dbAvailable) return;
    const owner = await registerAndLoginOwner('idor-owner');
    const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);
    const customerA = await registerAndLoginCustomer('idor-customer-a');
    const customerB = await registerAndLoginCustomer('idor-customer-b');
    const reservationId = await createCompletedReservation(
      customerA.accessToken,
      employee.accessToken,
      branchId,
      tableId,
    );

    await request(app!.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customerB.accessToken}`)
      .send({ reservationId, rating: 5 })
      .expect(404);
  });

  it('rejects a duplicate review for the same reservation', async () => {
    if (!dbAvailable) return;
    const owner = await registerAndLoginOwner('duplicate-owner');
    const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);
    const customer = await registerAndLoginCustomer('duplicate-customer');
    const reservationId = await createCompletedReservation(
      customer.accessToken,
      employee.accessToken,
      branchId,
      tableId,
    );

    await request(app!.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ reservationId, rating: 5 })
      .expect(201);

    await request(app!.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ reservationId, rating: 4 })
      .expect(409);
  });

  it('public restaurant review list shows the review, username only, no PII, and Swagger-relevant fields', async () => {
    if (!dbAvailable) return;
    const owner = await registerAndLoginOwner('public-list-owner');
    const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);
    const customer = await registerAndLoginCustomer('public-list-customer');
    const reservationId = await createCompletedReservation(
      customer.accessToken,
      employee.accessToken,
      branchId,
      tableId,
    );
    await request(app!.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ reservationId, rating: 5, comment: 'Loved it' })
      .expect(201);

    const listResponse = await request(app!.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/reviews`)
      .expect(200);

    expect(listResponse.body.data.total).toBe(1);
    const item = listResponse.body.data.items[0];
    expect(item.reviewerUsername).toBe(customer.username);
    expect(item).not.toHaveProperty('userId');
    expect(item).not.toHaveProperty('email');
    expect(item).not.toHaveProperty('phone');
    expect(JSON.stringify(item)).not.toContain(customer.email);
  });

  it("authenticated Customer's own review list contains their submitted review", async () => {
    if (!dbAvailable) return;
    const owner = await registerAndLoginOwner('mine-owner');
    const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);
    const customer = await registerAndLoginCustomer('mine-customer');
    const reservationId = await createCompletedReservation(
      customer.accessToken,
      employee.accessToken,
      branchId,
      tableId,
    );
    await request(app!.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ reservationId, rating: 5 })
      .expect(201);

    const mineResponse = await request(app!.getHttpServer())
      .get('/api/v1/users/me/reviews')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200);

    expect(mineResponse.body.data.total).toBe(1);
  });

  it('Customer deletes their own review; Owner/Admin administratively deletes another', async () => {
    if (!dbAvailable) return;
    const owner = await registerAndLoginOwner('delete-owner');
    const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);

    const customerA = await registerAndLoginCustomer('delete-customer-a');
    const reservationA = await createCompletedReservation(
      customerA.accessToken,
      employee.accessToken,
      branchId,
      tableId,
    );
    const reviewAResponse = await request(app!.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customerA.accessToken}`)
      .send({ reservationId: reservationA, rating: 3 })
      .expect(201);
    const reviewAId = reviewAResponse.body.data.reviewId as string;

    await request(app!.getHttpServer())
      .delete(`/api/v1/reviews/${reviewAId}`)
      .set('Authorization', `Bearer ${customerA.accessToken}`)
      .expect(204);

    const customerB = await registerAndLoginCustomer('delete-customer-b');
    const reservationB = await createCompletedReservation(
      customerB.accessToken,
      employee.accessToken,
      branchId,
      tableId,
    );
    const reviewBResponse = await request(app!.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customerB.accessToken}`)
      .send({ reservationId: reservationB, rating: 2 })
      .expect(201);
    const reviewBId = reviewBResponse.body.data.reviewId as string;

    // Employees may not delete reviews.
    await request(app!.getHttpServer())
      .delete(`/api/v1/reviews/${reviewBId}`)
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .expect(403);

    // Owner may administratively delete.
    await request(app!.getHttpServer())
      .delete(`/api/v1/reviews/${reviewBId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(204);

    // Deleted review disappears from the public listing.
    const listResponse = await request(app!.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/reviews`)
      .expect(200);
    expect(listResponse.body.data.items.map((i: { reviewId: string }) => i.reviewId)).not.toContain(
      reviewBId,
    );
  });

  it('rejects a cross-organization Owner/Admin delete attempt (404 IDOR-safe)', async () => {
    if (!dbAvailable) return;
    const owner = await registerAndLoginOwner('cross-org-owner');
    const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);
    const customer = await registerAndLoginCustomer('cross-org-customer');
    const reservationId = await createCompletedReservation(
      customer.accessToken,
      employee.accessToken,
      branchId,
      tableId,
    );
    const reviewResponse = await request(app!.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ reservationId, rating: 5 })
      .expect(201);
    const reviewId = reviewResponse.body.data.reviewId as string;

    const otherOwner = await registerAndLoginOwner('cross-org-other-owner');
    await request(app!.getHttpServer())
      .delete(`/api/v1/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${otherOwner.accessToken}`)
      .expect(404);
  });

  it('Owner/Admin replies once; a second reply and an Employee reply are both rejected', async () => {
    if (!dbAvailable) return;
    const owner = await registerAndLoginOwner('reply-owner');
    const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);
    const customer = await registerAndLoginCustomer('reply-customer');
    const reservationId = await createCompletedReservation(
      customer.accessToken,
      employee.accessToken,
      branchId,
      tableId,
    );
    const reviewResponse = await request(app!.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ reservationId, rating: 5 })
      .expect(201);
    const reviewId = reviewResponse.body.data.reviewId as string;

    // Employee may not reply.
    await request(app!.getHttpServer())
      .post(`/api/v1/reviews/${reviewId}/reply`)
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .send({ comment: 'Not allowed' })
      .expect(403);

    const replyResponse = await request(app!.getHttpServer())
      .post(`/api/v1/reviews/${reviewId}/reply`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ comment: 'Thank you so much!' })
      .expect(200);
    expect(replyResponse.body.data.reply.comment).toBe('Thank you so much!');

    // Second reply rejected.
    await request(app!.getHttpServer())
      .post(`/api/v1/reviews/${reviewId}/reply`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ comment: 'Second reply' })
      .expect(409);
  });

  it('adds review images up to the 5-image cap, rejects a 6th, and supports individual deletion', async () => {
    if (!dbAvailable) return;
    const owner = await registerAndLoginOwner('images-owner');
    const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);
    const customer = await registerAndLoginCustomer('images-customer');
    const reservationId = await createCompletedReservation(
      customer.accessToken,
      employee.accessToken,
      branchId,
      tableId,
    );
    const reviewResponse = await request(app!.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ reservationId, rating: 5 })
      .expect(201);
    const reviewId = reviewResponse.body.data.reviewId as string;

    let firstImageId = '';
    for (let i = 0; i < 5; i += 1) {
      const imageResponse = await request(app!.getHttpServer())
        .post(`/api/v1/reviews/${reviewId}/images`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .attach('file', validJpegBuffer, `photo${i}.jpg`)
        .expect(201);
      if (i === 0) {
        firstImageId = imageResponse.body.data.reviewImageId as string;
      }
    }

    await request(app!.getHttpServer())
      .post(`/api/v1/reviews/${reviewId}/images`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .attach('file', validJpegBuffer, 'photo6.jpg')
      .expect(409);

    // Another Customer cannot delete this image.
    const otherCustomer = await registerAndLoginCustomer('images-other-customer');
    await request(app!.getHttpServer())
      .delete(`/api/v1/reviews/${reviewId}/images/${firstImageId}`)
      .set('Authorization', `Bearer ${otherCustomer.accessToken}`)
      .expect(404);

    await request(app!.getHttpServer())
      .delete(`/api/v1/reviews/${reviewId}/images/${firstImageId}`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(204);

    // Freed a slot - a 6th upload now succeeds.
    await request(app!.getHttpServer())
      .post(`/api/v1/reviews/${reviewId}/images`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .attach('file', validJpegBuffer, 'photo7.jpg')
      .expect(201);
  });

  it('recomputes Restaurant.averageRating after Review create and delete', async () => {
    if (!dbAvailable) return;
    const owner = await registerAndLoginOwner('avg-owner');
    const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);
    const customer = await registerAndLoginCustomer('avg-customer');
    const reservationId = await createCompletedReservation(
      customer.accessToken,
      employee.accessToken,
      branchId,
      tableId,
    );
    const reviewResponse = await request(app!.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ reservationId, rating: 4 })
      .expect(201);
    const reviewId = reviewResponse.body.data.reviewId as string;

    let restaurantRow = await prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId } });
    expect(restaurantRow.averageRating?.toNumber()).toBe(4);

    await request(app!.getHttpServer())
      .delete(`/api/v1/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(204);

    restaurantRow = await prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId } });
    expect(restaurantRow.averageRating).toBeNull();
  });

  it('GET /reviews/:id (public) and 404 for an unknown id', async () => {
    if (!dbAvailable) return;
    const owner = await registerAndLoginOwner('get-by-id-owner');
    const { branchId, tableId, restaurantId } = await setUpRestaurantBranchTable(owner.accessToken);
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);
    const customer = await registerAndLoginCustomer('get-by-id-customer');
    const reservationId = await createCompletedReservation(
      customer.accessToken,
      employee.accessToken,
      branchId,
      tableId,
    );
    const reviewResponse = await request(app!.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ reservationId, rating: 5 })
      .expect(201);
    const reviewId = reviewResponse.body.data.reviewId as string;

    await request(app!.getHttpServer()).get(`/api/v1/reviews/${reviewId}`).expect(200);
    await request(app!.getHttpServer())
      .get('/api/v1/reviews/00000000-0000-4000-8000-000000000000')
      .expect(404);
  });

  it('Swagger document exposes exactly the frozen Phase 10 review routes', async () => {
    if (!dbAvailable) return;
    const { SwaggerModule, DocumentBuilder } = await import('@nestjs/swagger');
    const document = SwaggerModule.createDocument(
      app! as unknown as Parameters<typeof SwaggerModule.createDocument>[0],
      new DocumentBuilder().build(),
    );
    const reviewPaths = Object.keys(document.paths).filter((path) => path.includes('review'));
    expect(reviewPaths.sort()).toEqual(
      [
        '/api/v1/reviews',
        '/api/v1/restaurants/{restaurantId}/reviews',
        '/api/v1/users/me/reviews',
        '/api/v1/reviews/{id}',
        '/api/v1/reviews/{id}/reply',
        '/api/v1/reviews/{id}/images',
        '/api/v1/reviews/{id}/images/{imageId}',
      ].sort(),
    );
    expect(document.paths['/api/v1/reviews/{id}']).not.toHaveProperty('patch');
  });
});
