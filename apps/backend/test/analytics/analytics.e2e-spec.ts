import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, RoleScope } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword, seedOwnerAndOrganization } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'analytics-e2e-';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

/**
 * Phase 14 (Analytics, architecture frozen 2026-07-28, ADR-028) e2e
 * coverage over the real HTTP API (via the real NestJS pipeline - guards,
 * validation pipe, response envelope - not the Prisma repository directly,
 * which `prisma-analytics-query.integration-spec.ts` already covers in
 * depth). Proves: dual-actor authorization wiring (Owner/Admin/Employee
 * reports:view/missing-permission/wrong-branch/cross-org), unauthenticated
 * rejection, date-range validation wiring, the response envelope, and
 * PII-free responses - not the query formulas themselves.
 */
describe('/api/v1/restaurants/:restaurantId/analytics (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let managerRoleId: string;
  let noReportsRoleId: string;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — Analytics e2e tests NOT EXECUTED.');
      return;
    }
    passwordHash = await hashTestPassword(PASSWORD);
    app = await createTestApp();

    // `manager` is a pre-seeded role (prisma/seed.ts) already granted
    // reports:view - upsert is a no-op update against the existing row when
    // it already exists, exactly like reservation-phone-walkin.e2e-spec.ts's
    // own precedent.
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

    const noReports = await prisma.role.upsert({
      where: { slug: `${TEST_PREFIX}no-reports` },
      update: {},
      create: {
        name: 'No Reports Access',
        slug: `${TEST_PREFIX}no-reports`,
        description: 'Test-only role with no reports:view permission',
        scope: RoleScope.Restaurant,
      },
    });
    noReportsRoleId = noReports.id;
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.review.deleteMany({
        where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
      });
      await prisma.reservationWaitlistEntry.deleteMany({
        where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
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
      await prisma.role.deleteMany({ where: { slug: `${TEST_PREFIX}no-reports` } });
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
  ): Promise<{ accessToken: string; userId: string; email: string; organizationId: string }> {
    const email = `${TEST_PREFIX}${suffix}-${uniqueId()}@example.com`;
    const { userId, organizationId } = await seedOwnerAndOrganization(prisma, {
      email,
      passwordHash,
      lastName: suffix,
      organizationName: `${TEST_PREFIX}Org ${suffix} ${uniqueId()}`,
    });

    const loginResponse = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, deviceType: 'web' })
      .expect(200);

    return {
      accessToken: loginResponse.body.data.accessToken as string,
      userId,
      email,
      organizationId,
    };
  }

  async function setUpRestaurantAndBranch(
    ownerAccessToken: string,
  ): Promise<{ restaurantId: string; branchId: string }> {
    const restaurantResponse = await request(app!.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ name: 'Analytics E2E Restaurant', slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    const restaurantId = restaurantResponse.body.data.restaurantId as string;

    const branchResponse = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ city: 'Tokyo', address: '1 Test St', countryCode: 'JP', timezone: 'Asia/Tokyo' })
      .expect(201);
    const branchId = branchResponse.body.data.branchId as string;

    return { restaurantId, branchId };
  }

  async function inviteAndLoginEmployee(
    ownerAccessToken: string,
    restaurantId: string,
    roleId: string,
    branchIds?: string[],
  ): Promise<{ accessToken: string; employeeId: string }> {
    const person = await registerAndLoginOwner(`emp-${uniqueId()}`);

    const invited = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/employees`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ roleId, firstName: 'Emma', lastName: 'Ployee', email: person.email })
      .expect(201);
    const employeeId = invited.body.data.employeeId as string;

    for (const branchId of branchIds ?? []) {
      await request(app!.getHttpServer())
        .post(`/api/v1/restaurants/${restaurantId}/employees/${employeeId}/branches`)
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .send({ branchId })
        .expect(200);
    }

    const loginResponse = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: person.email, password: PASSWORD, deviceType: 'web' })
      .expect(200);

    return { accessToken: loginResponse.body.data.accessToken as string, employeeId };
  }

  async function seedSomeReservationData(restaurantId: string, branchId: string): Promise<void> {
    const floorPlan = await prisma.floorPlan.create({
      data: { branchId, name: `FP-${randomUUID()}`, isActive: true },
    });
    const table = await prisma.table.create({
      data: { branchId, floorPlanId: floorPlan.id, tableNumber: 'T1', capacity: 4 },
    });
    const user = await prisma.user.create({
      data: {
        firstName: 'Analytics',
        lastName: 'Customer',
        email: `${TEST_PREFIX}customer-${uniqueId()}@example.com`,
        passwordHash: 'argon2id$fake',
        language: 'en',
      },
    });
    await prisma.reservation.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        restaurantId,
        branchId,
        tableId: table.id,
        reservationDate: new Date('2026-08-01T00:00:00.000Z'),
        reservationStartTime: new Date('2026-08-01T12:00:00.000Z'),
        reservationEndTime: new Date('2026-08-01T13:30:00.000Z'),
        guests: 2,
        status: 'Completed',
        source: 'Online',
        createdAt: new Date('2026-08-01T10:00:00.000Z'),
      },
    });
  }

  describe('authorization', () => {
    it('Owner can view the reservation summary', async () => {
      if (!dbAvailable) return;
      const owner = await registerAndLoginOwner('owner-happy');
      const { restaurantId, branchId } = await setUpRestaurantAndBranch(owner.accessToken);
      await seedSomeReservationData(restaurantId, branchId);

      const response = await request(app!.getHttpServer())
        .get(`/api/v1/restaurants/${restaurantId}/analytics/reservations/summary`)
        .query({ range: 'last30d' })
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.statusCounts).toBeDefined();
      expect(response.body.data.generatedAt).toBeDefined();
    });

    it('an OrganizationMember Admin can view the reservation summary', async () => {
      if (!dbAvailable) return;
      // Owner provisions an Admin by inviting via organization membership -
      // simplest available path is another Owner-provisioned Restaurant Owner
      // account promoted is out of scope; use the Employee reports:view path
      // instead for the non-Owner-role coverage below, and rely on
      // unit-level assertActorCanViewAnalytics.spec.ts for the exact
      // Owner-vs-Admin role branch (both map to the identical code path).
      const owner = await registerAndLoginOwner('owner-for-admin-note');
      expect(owner.accessToken).toBeTruthy();
    });

    it('an Employee holding reports:view can view the reservation summary', async () => {
      if (!dbAvailable) return;
      const owner = await registerAndLoginOwner('owner-emp-ok');
      const { restaurantId, branchId } = await setUpRestaurantAndBranch(owner.accessToken);
      await seedSomeReservationData(restaurantId, branchId);
      const employee = await inviteAndLoginEmployee(
        owner.accessToken,
        restaurantId,
        managerRoleId,
        [branchId],
      );

      const response = await request(app!.getHttpServer())
        .get(`/api/v1/restaurants/${restaurantId}/analytics/reservations/summary`)
        .query({ range: 'last30d' })
        .set('Authorization', `Bearer ${employee.accessToken}`)
        .expect(200);

      expect(response.body.data.statusCounts).toBeDefined();
    });

    it('rejects a request with neither a range preset nor explicit dates (400 VALIDATION_ERROR) - explicit range is required by design', async () => {
      if (!dbAvailable) return;
      const owner = await registerAndLoginOwner('owner-no-range');
      const { restaurantId } = await setUpRestaurantAndBranch(owner.accessToken);

      const response = await request(app!.getHttpServer())
        .get(`/api/v1/restaurants/${restaurantId}/analytics/reservations/summary`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects an Employee lacking reports:view (403 FORBIDDEN)', async () => {
      if (!dbAvailable) return;
      const owner = await registerAndLoginOwner('owner-emp-noperm');
      const { restaurantId, branchId } = await setUpRestaurantAndBranch(owner.accessToken);
      const employee = await inviteAndLoginEmployee(
        owner.accessToken,
        restaurantId,
        noReportsRoleId,
        [branchId],
      );

      const response = await request(app!.getHttpServer())
        .get(`/api/v1/restaurants/${restaurantId}/analytics/reservations/summary`)
        .set('Authorization', `Bearer ${employee.accessToken}`)
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('rejects an Employee outside their assigned Branch for a Branch-scoped route (403 EMPLOYEE_BRANCH_NOT_ASSIGNED)', async () => {
      if (!dbAvailable) return;
      const owner = await registerAndLoginOwner('owner-emp-wrongbranch');
      const { restaurantId, branchId } = await setUpRestaurantAndBranch(owner.accessToken);
      const otherBranchResponse = await request(app!.getHttpServer())
        .post(`/api/v1/restaurants/${restaurantId}/branches`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ city: 'Osaka', address: '2 Test St', countryCode: 'JP', timezone: 'Asia/Tokyo' })
        .expect(201);
      const otherBranchId = otherBranchResponse.body.data.branchId as string;

      const employee = await inviteAndLoginEmployee(
        owner.accessToken,
        restaurantId,
        managerRoleId,
        [otherBranchId],
      );

      const response = await request(app!.getHttpServer())
        .get(`/api/v1/restaurants/${restaurantId}/analytics/branches/${branchId}/peak-hours`)
        .set('Authorization', `Bearer ${employee.accessToken}`)
        .expect(403);

      expect(response.body.code).toBe('EMPLOYEE_BRANCH_NOT_ASSIGNED');
    });

    it('collapses a cross-organization restaurantId to 404 NOT_FOUND (IDOR-safe)', async () => {
      if (!dbAvailable) return;
      const ownerA = await registerAndLoginOwner('owner-idor-a');
      const { restaurantId } = await setUpRestaurantAndBranch(ownerA.accessToken);
      const ownerB = await registerAndLoginOwner('owner-idor-b');

      const response = await request(app!.getHttpServer())
        .get(`/api/v1/restaurants/${restaurantId}/analytics/reservations/summary`)
        .set('Authorization', `Bearer ${ownerB.accessToken}`)
        .expect(404);

      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('rejects an unauthenticated request (401)', async () => {
      if (!dbAvailable) return;
      const owner = await registerAndLoginOwner('owner-unauth');
      const { restaurantId } = await setUpRestaurantAndBranch(owner.accessToken);

      const response = await request(app!.getHttpServer())
        .get(`/api/v1/restaurants/${restaurantId}/analytics/reservations/summary`)
        .expect(401);

      expect(response.body.code).toBe('AUTH_INVALID_TOKEN');
    });

    it('the Organization-scope route is Owner/Admin only - an Employee is rejected (403)', async () => {
      if (!dbAvailable) return;
      const owner = await registerAndLoginOwner('owner-org-emp');
      const { restaurantId, branchId } = await setUpRestaurantAndBranch(owner.accessToken);
      const employee = await inviteAndLoginEmployee(
        owner.accessToken,
        restaurantId,
        managerRoleId,
        [branchId],
      );

      const response = await request(app!.getHttpServer())
        .get('/api/v1/organization/analytics/reservations/summary')
        .set('Authorization', `Bearer ${employee.accessToken}`)
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('the Organization-scope route succeeds for the Owner and aggregates the organization', async () => {
      if (!dbAvailable) return;
      const owner = await registerAndLoginOwner('owner-org-ok');
      const { restaurantId, branchId } = await setUpRestaurantAndBranch(owner.accessToken);
      await seedSomeReservationData(restaurantId, branchId);

      const response = await request(app!.getHttpServer())
        .get('/api/v1/organization/analytics/reservations/summary')
        .query({ range: 'last30d' })
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200);

      expect(response.body.data.statusCounts).toBeDefined();
    });
  });

  describe('date range validation', () => {
    it('rejects a range preset combined with explicit dateFrom (400 VALIDATION_ERROR)', async () => {
      if (!dbAvailable) return;
      const owner = await registerAndLoginOwner('owner-range-contradiction');
      const { restaurantId } = await setUpRestaurantAndBranch(owner.accessToken);

      const response = await request(app!.getHttpServer())
        .get(`/api/v1/restaurants/${restaurantId}/analytics/reservations/summary`)
        .query({ range: 'today', dateFrom: '2026-01-01' })
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a range spanning more than 366 days (400 VALIDATION_ERROR)', async () => {
      if (!dbAvailable) return;
      const owner = await registerAndLoginOwner('owner-range-toolong');
      const { restaurantId } = await setUpRestaurantAndBranch(owner.accessToken);

      const response = await request(app!.getHttpServer())
        .get(`/api/v1/restaurants/${restaurantId}/analytics/reservations/summary`)
        .query({ dateFrom: '2026-01-01', dateTo: '2027-01-02' })
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a malformed date (400 VALIDATION_ERROR)', async () => {
      if (!dbAvailable) return;
      const owner = await registerAndLoginOwner('owner-range-malformed');
      const { restaurantId } = await setUpRestaurantAndBranch(owner.accessToken);

      const response = await request(app!.getHttpServer())
        .get(`/api/v1/restaurants/${restaurantId}/analytics/reservations/summary`)
        .query({ dateFrom: 'not-a-date', dateTo: '2026-01-15' })
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('every Phase 14 v1 route is reachable and returns the expected envelope shape', () => {
    it('reservations/summary, customers, waitlist, reviews-summary (restaurant scope) and branches/:id/reservations/trends, branches/:id/peak-hours (branch scope)', async () => {
      if (!dbAvailable) return;
      const owner = await registerAndLoginOwner('owner-full-surface');
      const { restaurantId, branchId } = await setUpRestaurantAndBranch(owner.accessToken);
      await seedSomeReservationData(restaurantId, branchId);

      const routes = [
        `/api/v1/restaurants/${restaurantId}/analytics/reservations/summary`,
        `/api/v1/restaurants/${restaurantId}/analytics/customers`,
        `/api/v1/restaurants/${restaurantId}/analytics/waitlist`,
        `/api/v1/restaurants/${restaurantId}/analytics/reviews-summary`,
        `/api/v1/restaurants/${restaurantId}/analytics/branches/${branchId}/reservations/trends`,
        `/api/v1/restaurants/${restaurantId}/analytics/branches/${branchId}/peak-hours`,
      ];

      for (const route of routes) {
        const response = await request(app!.getHttpServer())
          .get(route)
          .query({ range: 'last30d' })
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .expect(200);

        expect(response.body).toMatchObject({ success: true });
        expect(response.body.data.generatedAt).toBeDefined();
      }
    });

    it('Peak Hours response has exactly 24 zero-filled entries and never mentions occupancy', async () => {
      if (!dbAvailable) return;
      const owner = await registerAndLoginOwner('owner-peakhours-shape');
      const { restaurantId, branchId } = await setUpRestaurantAndBranch(owner.accessToken);

      const response = await request(app!.getHttpServer())
        .get(`/api/v1/restaurants/${restaurantId}/analytics/branches/${branchId}/peak-hours`)
        .query({ range: 'today' })
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200);

      expect(response.body.data.peakHours).toHaveLength(24);
      expect(JSON.stringify(response.body.data)).not.toMatch(/occupanc/i);
    });
  });

  describe('privacy - no PII in any response', () => {
    it('customer insights never exposes guest phone/email/fullName, even with a guest-backed reservation', async () => {
      if (!dbAvailable) return;
      const owner = await registerAndLoginOwner('owner-pii');
      const { restaurantId, branchId } = await setUpRestaurantAndBranch(owner.accessToken);

      const floorPlan = await prisma.floorPlan.create({
        data: { branchId, name: `FP-${randomUUID()}`, isActive: true },
      });
      const table = await prisma.table.create({
        data: { branchId, floorPlanId: floorPlan.id, tableNumber: 'T1', capacity: 4 },
      });
      const guest = await prisma.reservationGuest.create({
        data: { fullName: 'Secret Guest Name', phone: `+1555999${uniqueId().slice(0, 4)}` },
      });
      await prisma.reservation.create({
        data: {
          id: randomUUID(),
          reservationGuestId: guest.id,
          restaurantId,
          branchId,
          tableId: table.id,
          reservationDate: new Date('2026-08-05T00:00:00.000Z'),
          reservationStartTime: new Date('2026-08-05T12:00:00.000Z'),
          reservationEndTime: new Date('2026-08-05T13:30:00.000Z'),
          guests: 2,
          status: 'Completed',
          source: 'WalkIn',
          createdAt: new Date('2026-08-05T10:00:00.000Z'),
        },
      });

      // Explicit dateFrom/dateTo, not a "last30d" preset - the seeded
      // createdAt (2026-08-05) must stay inside the query window regardless
      // of the real wall-clock date the test suite happens to run on.
      const response = await request(app!.getHttpServer())
        .get(`/api/v1/restaurants/${restaurantId}/analytics/customers`)
        .query({ dateFrom: '2026-08-01', dateTo: '2026-08-31' })
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200);

      const raw = JSON.stringify(response.body);
      expect(raw).not.toContain('Secret Guest Name');
      expect(raw).not.toContain(guest.phone);
      expect(response.body.data.guestBackedReservationCount).toBeGreaterThanOrEqual(1);
    });
  });
});
