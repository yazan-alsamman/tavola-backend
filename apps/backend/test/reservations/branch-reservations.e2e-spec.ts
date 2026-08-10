import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, RoleScope } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword, seedOwnerAndOrganization } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'branch-reservations-e2e-';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

/**
 * Restaurant Dashboard Calendar - `GET /restaurants/:restaurantId/branches/
 * :branchId/reservations`. Real HTTP, real Postgres. Covers the Day/Week/
 * Month calendar usage (one date-range endpoint, per this endpoint's own
 * controller doc comment), the Employee-only actor gate, branch/restaurant
 * IDOR isolation, and the response envelope. Unit-level authorization/date-
 * validation branch coverage lives in `ListBranchReservationsUseCase`'s own
 * spec; join-query/filter coverage lives in `PrismaStaffReservationsReader`'s
 * own integration spec - this suite proves the real HTTP path end-to-end.
 */
describe('/api/v1/restaurants/:restaurantId/branches/:branchId/reservations (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let managerRoleId: string;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — branch reservations e2e tests NOT EXECUTED.');
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
    if (dbAvailable) {
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
    if (app) {
      await app.close();
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

  async function setUpRestaurantBranchTable(
    ownerAccessToken: string,
  ): Promise<{ restaurantId: string; branchId: string; tableId: string }> {
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

    return { restaurantId, branchId, tableId };
  }

  async function inviteAndLoginEmployee(
    ownerAccessToken: string,
    restaurantId: string,
    branchIds?: string[],
  ): Promise<{ accessToken: string; employeeId: string }> {
    const person = await registerAndLoginOwner(`emp-${uniqueId()}`);

    const invited = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/employees`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({
        roleId: managerRoleId,
        firstName: 'Emma',
        lastName: 'Ployee',
        email: person.email,
      })
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

  async function createReservation(
    customerAccessToken: string,
    branchId: string,
    tableId: string,
    overrides: Partial<{ reservationStartTime: string; reservationEndTime: string }> = {},
  ): Promise<string> {
    const response = await request(app!.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${customerAccessToken}`)
      .send({
        branchId,
        tableId,
        reservationStartTime: overrides.reservationStartTime ?? '2026-11-05T18:00:00.000Z',
        reservationEndTime: overrides.reservationEndTime ?? '2026-11-05T19:30:00.000Z',
        guests: 2,
      })
      .expect(201);
    return response.body.data.reservationId as string;
  }

  function calendarUrl(restaurantId: string, branchId: string): string {
    return `/api/v1/restaurants/${restaurantId}/branches/${branchId}/reservations`;
  }

  it('returns the branch reservations within the requested date range for a branch-scoped Employee (Day view)', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('day-owner');
    const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const customer = await registerAndLoginOwner('day-customer');
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId, [branchId]);
    const reservationId = await createReservation(customer.accessToken, branchId, tableId);

    const response = await request(app!.getHttpServer())
      .get(calendarUrl(restaurantId, branchId))
      .query({ dateFrom: '2026-11-05', dateTo: '2026-11-05' })
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .expect(200);

    expect(response.body.data.total).toBe(1);
    expect(response.body.data.page).toBe(1);
    expect(response.body.data.limit).toBe(20);
    const item = response.body.data.items[0];
    expect(item.reservationId).toBe(reservationId);
    expect(item.restaurantId).toBe(restaurantId);
    expect(item.branchId).toBe(branchId);
    expect(item.table.tableId).toBe(tableId);
    expect(item.customer.type).toBe('User');
    expect(item.status).toBe('Pending');
  });

  it('Week view: dateFrom/dateTo spanning the week returns the same reservation', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('week-owner');
    const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const customer = await registerAndLoginOwner('week-customer');
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId, [branchId]);
    await createReservation(customer.accessToken, branchId, tableId);

    const response = await request(app!.getHttpServer())
      .get(calendarUrl(restaurantId, branchId))
      .query({ dateFrom: '2026-11-02', dateTo: '2026-11-08' })
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .expect(200);

    expect(response.body.data.total).toBe(1);
  });

  it('Month view: dateFrom/dateTo spanning the month returns the same reservation', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('month-owner');
    const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const customer = await registerAndLoginOwner('month-customer');
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId, [branchId]);
    await createReservation(customer.accessToken, branchId, tableId);

    const response = await request(app!.getHttpServer())
      .get(calendarUrl(restaurantId, branchId))
      .query({ dateFrom: '2026-11-01', dateTo: '2026-11-30' })
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .expect(200);

    expect(response.body.data.total).toBe(1);
  });

  it('returns an empty page (200) for a date range with no reservations', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('empty-owner');
    const { restaurantId, branchId } = await setUpRestaurantBranchTable(owner.accessToken);
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId, [branchId]);

    const response = await request(app!.getHttpServer())
      .get(calendarUrl(restaurantId, branchId))
      .query({ dateFrom: '2026-12-01', dateTo: '2026-12-31' })
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .expect(200);

    expect(response.body.data.total).toBe(0);
    expect(response.body.data.items).toEqual([]);
  });

  it('allows a restaurant-wide Employee (no branch assignment) to view any branch of their own restaurant', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('wide-owner');
    const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const customer = await registerAndLoginOwner('wide-customer');
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);
    await createReservation(customer.accessToken, branchId, tableId);

    const response = await request(app!.getHttpServer())
      .get(calendarUrl(restaurantId, branchId))
      .query({ dateFrom: '2026-11-01', dateTo: '2026-11-30' })
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .expect(200);

    expect(response.body.data.total).toBe(1);
  });

  it('rejects an unauthenticated request with 401', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('unauth-owner');
    const { restaurantId, branchId } = await setUpRestaurantBranchTable(owner.accessToken);

    await request(app!.getHttpServer())
      .get(calendarUrl(restaurantId, branchId))
      .query({ dateFrom: '2026-11-01', dateTo: '2026-11-30' })
      .expect(401);
  });

  it('rejects a Customer actor with 403', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('customer-403-owner');
    const { restaurantId, branchId } = await setUpRestaurantBranchTable(owner.accessToken);
    const customer = await registerAndLoginOwner('customer-403-customer');

    await request(app!.getHttpServer())
      .get(calendarUrl(restaurantId, branchId))
      .query({ dateFrom: '2026-11-01', dateTo: '2026-11-30' })
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(403);
  });

  it('collapses a cross-restaurant Employee to 404 (IDOR-safe)', async () => {
    if (!dbAvailable) return;

    const ownerA = await registerAndLoginOwner('idor-a-owner');
    const { restaurantId: restaurantAId } = await setUpRestaurantBranchTable(ownerA.accessToken);
    const employeeA = await inviteAndLoginEmployee(ownerA.accessToken, restaurantAId);

    const ownerB = await registerAndLoginOwner('idor-b-owner');
    const { branchId: branchBId } = await setUpRestaurantBranchTable(ownerB.accessToken);

    await request(app!.getHttpServer())
      .get(calendarUrl(restaurantAId, branchBId))
      .query({ dateFrom: '2026-11-01', dateTo: '2026-11-30' })
      .set('Authorization', `Bearer ${employeeA.accessToken}`)
      .expect(404);
  });

  it('rejects an Employee assigned to a different branch with 403 EMPLOYEE_BRANCH_NOT_ASSIGNED', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('scope-owner');
    const restaurantResponse = await request(app!.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'The Old Mill', slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    const restaurantId = restaurantResponse.body.data.restaurantId as string;

    async function createBranch() {
      const branchResponse = await request(app!.getHttpServer())
        .post(`/api/v1/restaurants/${restaurantId}/branches`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          city: 'Damascus',
          address: `${uniqueId()} Main St`,
          countryCode: 'SY',
          timezone: 'Asia/Damascus',
        })
        .expect(201);
      return branchResponse.body.data.branchId as string;
    }

    const branchAId = await createBranch();
    const branchBId = await createBranch();
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId, [branchAId]);

    const response = await request(app!.getHttpServer())
      .get(calendarUrl(restaurantId, branchBId))
      .query({ dateFrom: '2026-11-01', dateTo: '2026-11-30' })
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .expect(403);

    expect(response.body.code).toBe('EMPLOYEE_BRANCH_NOT_ASSIGNED');
  });

  it('rejects dateFrom after dateTo with 400 VALIDATION_ERROR', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('invalid-range-owner');
    const { restaurantId, branchId } = await setUpRestaurantBranchTable(owner.accessToken);
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId, [branchId]);

    const response = await request(app!.getHttpServer())
      .get(calendarUrl(restaurantId, branchId))
      .query({ dateFrom: '2026-11-30', dateTo: '2026-11-01' })
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a request missing dateFrom/dateTo with 400 VALIDATION_ERROR', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('missing-range-owner');
    const { restaurantId, branchId } = await setUpRestaurantBranchTable(owner.accessToken);
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId, [branchId]);

    await request(app!.getHttpServer())
      .get(calendarUrl(restaurantId, branchId))
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .expect(400);
  });

  it('filters by status', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('status-owner');
    const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
    const customer = await registerAndLoginOwner('status-customer');
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId, [branchId]);
    const reservationId = await createReservation(customer.accessToken, branchId, tableId);

    await request(app!.getHttpServer())
      .post(`/api/v1/reservations/${reservationId}/approve`)
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .expect(200);

    const pendingResponse = await request(app!.getHttpServer())
      .get(calendarUrl(restaurantId, branchId))
      .query({ dateFrom: '2026-11-01', dateTo: '2026-11-30', status: 'Pending' })
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .expect(200);
    expect(pendingResponse.body.data.total).toBe(0);

    const approvedResponse = await request(app!.getHttpServer())
      .get(calendarUrl(restaurantId, branchId))
      .query({ dateFrom: '2026-11-01', dateTo: '2026-11-30', status: 'Approved' })
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .expect(200);
    expect(approvedResponse.body.data.total).toBe(1);
    expect(approvedResponse.body.data.items[0].status).toBe('Approved');
  });
});
