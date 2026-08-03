import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, RoleScope } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword, seedOwnerAndOrganization } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'offers-e2e-';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Relative to the real wall clock, never a hardcoded calendar date. */
function isoOffsetDays(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

/**
 * Phase 11 (Offers, architecture frozen 2026-07-28, implemented 2026-07-28)
 * full e2e coverage: Owner/Admin management CRUD/Publish/Delete, Employee
 * denial, the Customer/public read surface via
 * `GET /discovery/restaurants/:restaurantId/offers` (Published + currently
 * active + not soft-deleted only), IDOR/cross-org isolation, and real
 * BullMQ expiration - against a real Postgres/Redis-backed running
 * application.
 */
describe('/api/v1/restaurants/:restaurantId/offers (e2e, Phase 11)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let managerRoleId: string;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — offers e2e tests NOT EXECUTED.');
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
    try {
      if (dbAvailable) {
        await prisma.offer.deleteMany({
          where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
        });
        await prisma.employeeBranchAssignment.deleteMany({
          where: { employee: { restaurant: { slug: { startsWith: TEST_PREFIX } } } },
        });
        await prisma.employee.deleteMany({
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

  async function setUpRestaurant(ownerAccessToken: string): Promise<string> {
    const restaurantResponse = await request(app!.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ name: 'Offers Bistro', slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    return restaurantResponse.body.data.restaurantId as string;
  }

  /**
   * `POST /restaurants/:restaurantId/employees` only creates an `Invited`,
   * unlinked `Employee` row - it links to a `User` on that email's NEXT
   * login, and only if a `User` with that email already exists (see
   * `test/employees/employees.e2e-spec.ts`). A bare `User` row (no
   * Organization needed) is created directly first, matching
   * `my-reservations.e2e-spec.ts`'s own `registerAndLoginCustomer` pattern.
   */
  async function inviteAndLoginEmployee(
    ownerAccessToken: string,
    restaurantId: string,
  ): Promise<{ accessToken: string }> {
    const employeeEmail = `${TEST_PREFIX}emp-${uniqueId()}@example.com`;
    await prisma.user.create({
      data: {
        id: randomUUID(),
        firstName: 'Emma',
        lastName: 'Ployee',
        email: employeeEmail,
        passwordHash,
        language: 'en',
        status: 'Active',
        emailVerified: true,
      },
    });

    await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/employees`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ roleId: managerRoleId, firstName: 'Emma', lastName: 'Ployee', email: employeeEmail })
      .expect(201);

    const loginResponse = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: employeeEmail, password: PASSWORD, deviceType: 'web' })
      .expect(200);
    return { accessToken: loginResponse.body.data.accessToken as string };
  }

  function offerPayload(overrides?: {
    type?: string;
    title?: string;
    discountType?: string;
    discountValue?: number;
    startsAt?: string;
    endsAt?: string;
  }) {
    return {
      type: overrides?.type ?? 'Promotion',
      title: overrides?.title ?? '20% Off Weekday Lunch',
      description: 'Enjoy 20% off any lunch entree.',
      discountType: overrides?.discountType ?? 'Percentage',
      discountValue: overrides?.discountValue ?? 20,
      startsAt: overrides?.startsAt ?? '2026-08-01T00:00:00.000Z',
      endsAt: overrides?.endsAt ?? '2026-08-31T23:59:59.000Z',
    };
  }

  it('Owner/Admin: full lifecycle - create Draft, update Draft, publish, list management, delete', async () => {
    if (!dbAvailable) return;
    const owner = await registerAndLoginOwner('lifecycle');
    const restaurantId = await setUpRestaurant(owner.accessToken);

    const createResponse = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/offers`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(offerPayload())
      .expect(201);
    const offerId = createResponse.body.data.offerId as string;
    expect(createResponse.body.data.status).toBe('Draft');

    const updateResponse = await request(app!.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/offers/${offerId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(offerPayload({ title: 'Updated Title' }))
      .expect(200);
    expect(updateResponse.body.data.title).toBe('Updated Title');

    const publishResponse = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/offers/${offerId}/publish`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(publishResponse.body.data.status).toBe('Published');

    // Published is immutable.
    await request(app!.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/offers/${offerId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(offerPayload({ title: 'Should Fail' }))
      .expect(400);

    const listResponse = await request(app!.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/offers`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(
      listResponse.body.data.items.some((i: { offerId: string }) => i.offerId === offerId),
    ).toBe(true);

    await request(app!.getHttpServer())
      .delete(`/api/v1/restaurants/${restaurantId}/offers/${offerId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(204);

    // Not idempotent - a second delete 404s.
    await request(app!.getHttpServer())
      .delete(`/api/v1/restaurants/${restaurantId}/offers/${offerId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(404);
  });

  it('Employee: denied on every management route (403)', async () => {
    if (!dbAvailable) return;
    const owner = await registerAndLoginOwner('employee-denied');
    const restaurantId = await setUpRestaurant(owner.accessToken);
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);

    await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/offers`)
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .send(offerPayload())
      .expect(403);

    await request(app!.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/offers`)
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .expect(403);
  });

  it('cross-organization management access is denied (IDOR-safe 404)', async () => {
    if (!dbAvailable) return;
    const ownerA = await registerAndLoginOwner('cross-a');
    const ownerB = await registerAndLoginOwner('cross-b');
    const restaurantAId = await setUpRestaurant(ownerA.accessToken);

    const createResponse = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantAId}/offers`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send(offerPayload())
      .expect(201);
    const offerId = createResponse.body.data.offerId as string;

    await request(app!.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantAId}/offers`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .expect(404);

    await request(app!.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantAId}/offers/${offerId}`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send(offerPayload())
      .expect(404);
  });

  it('Customer/public: sees only active Published offers via Discovery; never Draft/future/Expired/deleted', async () => {
    if (!dbAvailable) return;
    const owner = await registerAndLoginOwner('public-visibility');
    const restaurantId = await setUpRestaurant(owner.accessToken);

    // Draft - never public.
    const draftResponse = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/offers`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(offerPayload({ title: 'Draft Offer' }))
      .expect(201);

    // Published, active now.
    const activeResponse = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/offers`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(
        offerPayload({
          title: 'Active Offer',
          startsAt: isoOffsetDays(-1),
          endsAt: isoOffsetDays(30),
        }),
      )
      .expect(201);
    const activeOfferId = activeResponse.body.data.offerId as string;
    await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/offers/${activeOfferId}/publish`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    // Published, but starts in the future.
    const futureResponse = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/offers`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(
        offerPayload({
          title: 'Future Offer',
          startsAt: isoOffsetDays(60),
          endsAt: isoOffsetDays(90),
        }),
      )
      .expect(201);
    const futureOfferId = futureResponse.body.data.offerId as string;
    await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/offers/${futureOfferId}/publish`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    // Published, then soft-deleted.
    const deletedResponse = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/offers`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(
        offerPayload({
          title: 'Deleted Offer',
          startsAt: isoOffsetDays(-1),
          endsAt: isoOffsetDays(30),
        }),
      )
      .expect(201);
    const deletedOfferId = deletedResponse.body.data.offerId as string;
    await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/offers/${deletedOfferId}/publish`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    await request(app!.getHttpServer())
      .delete(`/api/v1/restaurants/${restaurantId}/offers/${deletedOfferId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(204);

    // Public read - no Authorization header at all.
    const publicResponse = await request(app!.getHttpServer())
      .get(`/api/v1/discovery/restaurants/${restaurantId}/offers`)
      .expect(200);

    const ids = publicResponse.body.data.items.map((i: { offerId: string }) => i.offerId);
    expect(ids).toContain(activeOfferId);
    expect(ids).not.toContain(draftResponse.body.data.offerId);
    expect(ids).not.toContain(futureOfferId);
    expect(ids).not.toContain(deletedOfferId);
  });

  it('public Offer listing is cross-organization discoverable, same as restaurant discovery itself', async () => {
    if (!dbAvailable) return;
    const ownerA = await registerAndLoginOwner('cross-org-public-a');
    const ownerB = await registerAndLoginOwner('cross-org-public-b');
    const restaurantAId = await setUpRestaurant(ownerA.accessToken);
    const restaurantBId = await setUpRestaurant(ownerB.accessToken);

    for (const [restaurantId, ownerToken] of [
      [restaurantAId, ownerA.accessToken],
      [restaurantBId, ownerB.accessToken],
    ] as const) {
      const created = await request(app!.getHttpServer())
        .post(`/api/v1/restaurants/${restaurantId}/offers`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(
          offerPayload({
            startsAt: isoOffsetDays(-1),
            endsAt: isoOffsetDays(30),
          }),
        )
        .expect(201);
      await request(app!.getHttpServer())
        .post(`/api/v1/restaurants/${restaurantId}/offers/${created.body.data.offerId}/publish`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
    }

    const publicA = await request(app!.getHttpServer())
      .get(`/api/v1/discovery/restaurants/${restaurantAId}/offers`)
      .expect(200);
    const publicB = await request(app!.getHttpServer())
      .get(`/api/v1/discovery/restaurants/${restaurantBId}/offers`)
      .expect(200);

    expect(publicA.body.data.items).toHaveLength(1);
    expect(publicB.body.data.items).toHaveLength(1);
  });

  it('a Published offer automatically expires via real BullMQ, and the public endpoint stops returning it', async () => {
    if (!dbAvailable) return;
    const owner = await registerAndLoginOwner('expiration');
    const restaurantId = await setUpRestaurant(owner.accessToken);

    const nowPlus4s = new Date(Date.now() + 4000).toISOString();
    const nowMinus1s = new Date(Date.now() - 1000).toISOString();

    const createResponse = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/offers`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(offerPayload({ startsAt: nowMinus1s, endsAt: nowPlus4s }))
      .expect(201);
    const offerId = createResponse.body.data.offerId as string;

    await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/offers/${offerId}/publish`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    // Confirm it is publicly active right after publish.
    const beforeExpiry = await request(app!.getHttpServer())
      .get(`/api/v1/discovery/restaurants/${restaurantId}/offers`)
      .expect(200);
    expect(
      beforeExpiry.body.data.items.some((i: { offerId: string }) => i.offerId === offerId),
    ).toBe(true);

    // Poll (bounded) until the real BullMQ job has fired and flipped the
    // row to Expired - never a fixed sleep guessing at timing.
    let expiredInDb = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const row = await prisma.offer.findUnique({ where: { id: offerId } });
      if (row?.status === 'Expired') {
        expiredInDb = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(expiredInDb).toBe(true);

    const afterExpiry = await request(app!.getHttpServer())
      .get(`/api/v1/discovery/restaurants/${restaurantId}/offers`)
      .expect(200);
    expect(
      afterExpiry.body.data.items.some((i: { offerId: string }) => i.offerId === offerId),
    ).toBe(false);

    const managementAfterExpiry = await request(app!.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/offers`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    const managed = managementAfterExpiry.body.data.items.find(
      (i: { offerId: string }) => i.offerId === offerId,
    );
    expect(managed?.status).toBe('Expired');

    const auditRow = await prisma.auditLog.findFirst({
      where: { targetId: offerId, action: 'offer.expired' },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.actorType).toBe('System');
    expect(auditRow?.actorId).toBeNull();
  }, 20000);

  it('unauthenticated request to a management route is rejected (401)', async () => {
    if (!dbAvailable) return;
    const owner = await registerAndLoginOwner('unauth');
    const restaurantId = await setUpRestaurant(owner.accessToken);

    await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/offers`)
      .send(offerPayload())
      .expect(401);
  });
});
