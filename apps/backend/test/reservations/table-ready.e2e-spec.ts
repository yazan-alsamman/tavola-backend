import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, RoleScope } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword, seedOwnerAndOrganization } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'reservation-table-ready-e2e-';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

/**
 * Phase 7.6 (Operational Signals, ADR-019) e2e coverage: `POST
 * /reservations/:id/table-ready`. Staff-only (`reservations:tableready`,
 * branch-scoped) - not a status transition, so unlike Complete/NoShow the
 * `Table` row is never touched and `status` stays `Approved`.
 */
describe('/api/v1/reservations/:id/table-ready (e2e, Phase 7.6)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let managerRoleId: string;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — table-ready e2e tests NOT EXECUTED.');
      return;
    }
    passwordHash = await hashTestPassword(PASSWORD);
    app = await createTestApp();

    // Real seeded `manager` slug (prisma/seed.ts) - carries
    // reservations:tableready via RolePermission rows, not recreated here.
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

  async function registerAndLoginCustomer(
    suffix: string,
  ): Promise<{ accessToken: string; userId: string; email: string }> {
    const email = `${TEST_PREFIX}${suffix}-${uniqueId()}@example.com`;
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Test',
        lastName: suffix,
        email,
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

    return { accessToken: loginResponse.body.data.accessToken as string, userId, email };
  }

  async function setUpRestaurantBranchTables(
    ownerAccessToken: string,
    tableCount = 1,
  ): Promise<{ restaurantId: string; branchId: string; tableIds: string[] }> {
    const restaurantResponse = await request(app!.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ name: 'The Table-Ready Bistro', slug: `${TEST_PREFIX}${uniqueId()}` })
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

    const tableIds: string[] = [];
    for (let i = 0; i < tableCount; i += 1) {
      const tableResponse = await request(app!.getHttpServer())
        .post(`/api/v1/restaurants/${restaurantId}/branches/${branchId}/tables`)
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .send({ floorPlanId, tableNumber: `T${i + 1}`, capacity: 4 })
        .expect(201);
      tableIds.push(tableResponse.body.data.tableId as string);
    }

    return { restaurantId, branchId, tableIds };
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

  async function createApprovedReservation(
    customerAccessToken: string,
    employeeAccessToken: string,
    branchId: string,
    tableId: string,
    overrides: Partial<{ reservationStartTime: string; reservationEndTime: string }> = {},
  ): Promise<string> {
    const createResponse = await request(app!.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${customerAccessToken}`)
      .send({
        branchId,
        tableId,
        reservationStartTime: overrides.reservationStartTime ?? '2026-12-01T18:00:00.000Z',
        reservationEndTime: overrides.reservationEndTime ?? '2026-12-01T19:30:00.000Z',
        guests: 2,
      })
      .expect(201);
    const reservationId = createResponse.body.data.reservationId as string;

    await request(app!.getHttpServer())
      .post(`/api/v1/reservations/${reservationId}/approve`)
      .set('Authorization', `Bearer ${employeeAccessToken}`)
      .expect(200);
    return reservationId;
  }

  it('marks an Approved reservation table-ready without touching its status or Table', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('success-owner');
    const { restaurantId, branchId, tableIds } = await setUpRestaurantBranchTables(
      owner.accessToken,
    );
    const customer = await registerAndLoginCustomer('success-customer');
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);
    const reservationId = await createApprovedReservation(
      customer.accessToken,
      employee.accessToken,
      branchId,
      tableIds[0],
      {
        reservationStartTime: '2026-12-20T18:00:00.000Z',
        reservationEndTime: '2026-12-20T19:30:00.000Z',
      },
    );

    const response = await request(app!.getHttpServer())
      .post(`/api/v1/reservations/${reservationId}/table-ready`)
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .expect(200);

    expect(response.body.data.status).toBe('Approved');

    const tableRow = await prisma.table.findUnique({ where: { id: tableIds[0] } });
    expect(tableRow?.status).toBe('Reserved');

    const reservationRow = await prisma.reservation.findUnique({ where: { id: reservationId } });
    expect(reservationRow?.tableReadyNotifiedAt).not.toBeNull();
  });

  it('rejects marking table-ready a second time (already notified)', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('double-owner');
    const { restaurantId, branchId, tableIds } = await setUpRestaurantBranchTables(
      owner.accessToken,
    );
    const customer = await registerAndLoginCustomer('double-customer');
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);
    const reservationId = await createApprovedReservation(
      customer.accessToken,
      employee.accessToken,
      branchId,
      tableIds[0],
      {
        reservationStartTime: '2026-12-21T18:00:00.000Z',
        reservationEndTime: '2026-12-21T19:30:00.000Z',
      },
    );

    await request(app!.getHttpServer())
      .post(`/api/v1/reservations/${reservationId}/table-ready`)
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .expect(200);

    const repeat = await request(app!.getHttpServer())
      .post(`/api/v1/reservations/${reservationId}/table-ready`)
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .expect(400);
    expect(repeat.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects marking table-ready a Pending reservation (not yet Approved)', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('pending-owner');
    const { restaurantId, branchId, tableIds } = await setUpRestaurantBranchTables(
      owner.accessToken,
    );
    const customer = await registerAndLoginCustomer('pending-customer');
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId, [branchId]);

    const createResponse = await request(app!.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({
        branchId,
        tableId: tableIds[0],
        reservationStartTime: '2026-12-22T18:00:00.000Z',
        reservationEndTime: '2026-12-22T19:30:00.000Z',
        guests: 2,
      })
      .expect(201);
    const reservationId = createResponse.body.data.reservationId as string;

    const response = await request(app!.getHttpServer())
      .post(`/api/v1/reservations/${reservationId}/table-ready`)
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 unauthenticated, 403 for a Customer actor (no reservations:tableready), and 403 for an Employee outside branch scope', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('authz-owner');
    const { restaurantId, branchId, tableIds } = await setUpRestaurantBranchTables(
      owner.accessToken,
    );
    const otherBranchResponse = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        city: 'Aleppo',
        address: '456 Side St',
        countryCode: 'SY',
        timezone: 'Asia/Damascus',
      })
      .expect(201);
    const otherBranchId = otherBranchResponse.body.data.branchId as string;

    const customer = await registerAndLoginCustomer('authz-customer');
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);
    const reservationId = await createApprovedReservation(
      customer.accessToken,
      employee.accessToken,
      branchId,
      tableIds[0],
      {
        reservationStartTime: '2026-12-23T18:00:00.000Z',
        reservationEndTime: '2026-12-23T19:30:00.000Z',
      },
    );

    await request(app!.getHttpServer())
      .post(`/api/v1/reservations/${reservationId}/table-ready`)
      .expect(401);

    const customerResponse = await request(app!.getHttpServer())
      .post(`/api/v1/reservations/${reservationId}/table-ready`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(403);
    expect(customerResponse.body.code).toBe('FORBIDDEN');

    const outOfScopeEmployee = await inviteAndLoginEmployee(owner.accessToken, restaurantId, [
      otherBranchId,
    ]);
    const outOfScopeResponse = await request(app!.getHttpServer())
      .post(`/api/v1/reservations/${reservationId}/table-ready`)
      .set('Authorization', `Bearer ${outOfScopeEmployee.accessToken}`)
      .expect(403);
    expect(outOfScopeResponse.body.code).toBe('EMPLOYEE_BRANCH_NOT_ASSIGNED');
  });

  it('returns 404 for a reservation that does not exist', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('notfound-owner');
    const { restaurantId } = await setUpRestaurantBranchTables(owner.accessToken);
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);

    const response = await request(app!.getHttpServer())
      .post(`/api/v1/reservations/${randomUUID()}/table-ready`)
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .expect(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });
});
