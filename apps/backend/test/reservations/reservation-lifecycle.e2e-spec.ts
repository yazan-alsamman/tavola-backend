import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, RoleScope } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword, seedOwnerAndOrganization } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'reservation-lifecycle-e2e-';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

/**
 * Phase 7.3 (Reservation Lifecycle, architecture frozen 2026-07-23) e2e
 * coverage: `POST /reservations/:id/{cancel,reschedule,complete,no-show}`
 * for both the owning Customer and a branch-scoped Employee, against a real
 * Postgres-backed running application. Complete/NoShow's "service window has
 * begun" timing gate is made deterministic (no real-time sleeping) by
 * directly back-dating the persisted `reservationStartTime`/`reservationEndTime`
 * via `prisma` after Approval - the same technique the domain/integration
 * suites use to avoid flaky timing-dependent tests.
 */
describe('/api/v1/reservations/:id/{cancel,reschedule,complete,no-show} (e2e, Phase 7.3)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let managerRoleId: string;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — reservation lifecycle e2e tests NOT EXECUTED.');
      return;
    }
    passwordHash = await hashTestPassword(PASSWORD);
    app = await createTestApp();

    // Real seeded `manager` slug (prisma/seed.ts) - carries
    // reservations:cancel/reschedule/complete/no-show via RolePermission
    // rows, not recreated here.
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

  /**
   * A genuine `AccessTokenActorType.User` (Customer) fixture - deliberately
   * NOT `registerAndLoginOwner` (that also creates an `OrganizationMember`
   * row, which `AccessTokenClaimsBuilder` resolves to actorType
   * `OrganizationMember`, not `User` - see its Employee > OrganizationMember
   * > User precedence). Cancel/Reschedule's ownership-based authorization
   * branch only special-cases `User`, so the Customer fixture here must be a
   * bare `User` row with no `Organization`/`OrganizationMember` at all.
   */
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
      .send({ name: 'The Lifecycle Bistro', slug: `${TEST_PREFIX}${uniqueId()}` })
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

  async function createPendingReservation(
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
        reservationStartTime: overrides.reservationStartTime ?? '2026-12-01T18:00:00.000Z',
        reservationEndTime: overrides.reservationEndTime ?? '2026-12-01T19:30:00.000Z',
        guests: 2,
      })
      .expect(201);
    return response.body.data.reservationId as string;
  }

  async function createApprovedReservation(
    customerAccessToken: string,
    employeeAccessToken: string,
    branchId: string,
    tableId: string,
    overrides: Partial<{ reservationStartTime: string; reservationEndTime: string }> = {},
  ): Promise<string> {
    const reservationId = await createPendingReservation(
      customerAccessToken,
      branchId,
      tableId,
      overrides,
    );
    await request(app!.getHttpServer())
      .post(`/api/v1/reservations/${reservationId}/approve`)
      .set('Authorization', `Bearer ${employeeAccessToken}`)
      .expect(200);
    return reservationId;
  }

  /** Deterministically satisfies the "service window has begun" timing gate. */
  async function backdateToWithinServiceWindow(reservationId: string): Promise<void> {
    await prisma.reservation.update({
      where: { id: reservationId },
      data: {
        reservationStartTime: new Date(Date.now() - 5 * 60_000),
        reservationEndTime: new Date(Date.now() + 55 * 60_000),
      },
    });
  }

  describe('Cancel', () => {
    it("cancels the owning Customer's own Pending reservation - Table remains Available", async () => {
      if (!dbAvailable) return;

      const owner = await registerAndLoginOwner('cancel-owner');
      const { branchId, tableIds } = await setUpRestaurantBranchTables(owner.accessToken);
      const customer = await registerAndLoginCustomer('cancel-customer');
      const reservationId = await createPendingReservation(
        customer.accessToken,
        branchId,
        tableIds[0],
      );

      const response = await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/cancel`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ reason: 'Change of plans' })
        .expect(200);

      expect(response.body.data.status).toBe('Cancelled');
      expect(response.body.data.cancelledAt).not.toBeNull();

      const tableRow = await prisma.table.findUnique({ where: { id: tableIds[0] } });
      expect(tableRow?.status).toBe('Available');

      const historyRow = await prisma.reservationHistory.findFirst({
        where: { reservationId, newStatus: 'Cancelled' },
      });
      expect(historyRow).not.toBeNull();
      expect(historyRow?.changedBy).toBe(customer.userId);
    });

    it("cancels the owning Customer's own Approved reservation - releases the Table to Available", async () => {
      if (!dbAvailable) return;

      const owner = await registerAndLoginOwner('cancel-approved-owner');
      const { restaurantId, branchId, tableIds } = await setUpRestaurantBranchTables(
        owner.accessToken,
      );
      const customer = await registerAndLoginCustomer('cancel-approved-customer');
      const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);
      const reservationId = await createApprovedReservation(
        customer.accessToken,
        employee.accessToken,
        branchId,
        tableIds[0],
        {
          reservationStartTime: '2026-12-02T18:00:00.000Z',
          reservationEndTime: '2026-12-02T19:30:00.000Z',
        },
      );

      const response = await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/cancel`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ reason: null })
        .expect(200);

      expect(response.body.data.status).toBe('Cancelled');
      const tableRow = await prisma.table.findUnique({ where: { id: tableIds[0] } });
      expect(tableRow?.status).toBe('Available');
    });

    it("returns 404 for another Customer's reservation (IDOR)", async () => {
      if (!dbAvailable) return;

      const owner = await registerAndLoginOwner('cancel-idor-owner');
      const { branchId, tableIds } = await setUpRestaurantBranchTables(owner.accessToken);
      const customerA = await registerAndLoginCustomer('cancel-idor-a');
      const customerB = await registerAndLoginCustomer('cancel-idor-b');
      const reservationId = await createPendingReservation(
        customerA.accessToken,
        branchId,
        tableIds[0],
        {
          reservationStartTime: '2026-12-03T18:00:00.000Z',
          reservationEndTime: '2026-12-03T19:30:00.000Z',
        },
      );

      const response = await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/cancel`)
        .set('Authorization', `Bearer ${customerB.accessToken}`)
        .send({ reason: null })
        .expect(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('allows a branch-scoped Employee with reservations:cancel to cancel, and rejects one outside branch scope', async () => {
      if (!dbAvailable) return;

      const owner = await registerAndLoginOwner('cancel-employee-owner');
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

      const customer = await registerAndLoginCustomer('cancel-employee-customer');
      const scopedEmployee = await inviteAndLoginEmployee(owner.accessToken, restaurantId, [
        branchId,
      ]);
      const outOfScopeEmployee = await inviteAndLoginEmployee(owner.accessToken, restaurantId, [
        otherBranchId,
      ]);

      const reservationForScoped = await createPendingReservation(
        customer.accessToken,
        branchId,
        tableIds[0],
        {
          reservationStartTime: '2026-12-04T18:00:00.000Z',
          reservationEndTime: '2026-12-04T19:30:00.000Z',
        },
      );
      await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationForScoped}/cancel`)
        .set('Authorization', `Bearer ${scopedEmployee.accessToken}`)
        .send({ reason: null })
        .expect(200);

      const reservationForOutOfScope = await createPendingReservation(
        customer.accessToken,
        branchId,
        tableIds[0],
        {
          reservationStartTime: '2026-12-05T18:00:00.000Z',
          reservationEndTime: '2026-12-05T19:30:00.000Z',
        },
      );
      const outOfScopeResponse = await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationForOutOfScope}/cancel`)
        .set('Authorization', `Bearer ${outOfScopeEmployee.accessToken}`)
        .send({ reason: null })
        .expect(403);
      expect(outOfScopeResponse.body.code).toBe('EMPLOYEE_BRANCH_NOT_ASSIGNED');
    });

    it('returns 401 unauthenticated and 400 when cancelling an already-Cancelled reservation', async () => {
      if (!dbAvailable) return;

      const owner = await registerAndLoginOwner('cancel-authz-owner');
      const { branchId, tableIds } = await setUpRestaurantBranchTables(owner.accessToken);
      const customer = await registerAndLoginCustomer('cancel-authz-customer');
      const reservationId = await createPendingReservation(
        customer.accessToken,
        branchId,
        tableIds[0],
        {
          reservationStartTime: '2026-12-06T18:00:00.000Z',
          reservationEndTime: '2026-12-06T19:30:00.000Z',
        },
      );

      await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/cancel`)
        .send({ reason: null })
        .expect(401);

      await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/cancel`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ reason: null })
        .expect(200);

      const repeat = await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/cancel`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ reason: null })
        .expect(400);
      expect(repeat.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Reschedule', () => {
    it('reschedules a Pending reservation to a different table and time - no Table operation', async () => {
      if (!dbAvailable) return;

      const owner = await registerAndLoginOwner('reschedule-owner');
      const { branchId, tableIds } = await setUpRestaurantBranchTables(owner.accessToken, 2);
      const customer = await registerAndLoginCustomer('reschedule-customer');
      const reservationId = await createPendingReservation(
        customer.accessToken,
        branchId,
        tableIds[0],
        {
          reservationStartTime: '2026-12-07T18:00:00.000Z',
          reservationEndTime: '2026-12-07T19:30:00.000Z',
        },
      );

      const response = await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/reschedule`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({
          tableId: tableIds[1],
          reservationStartTime: '2026-12-08T18:00:00.000Z',
          reservationEndTime: '2026-12-08T19:30:00.000Z',
        })
        .expect(200);

      expect(response.body.data.tableId).toBe(tableIds[1]);
      expect(new Date(response.body.data.reservationStartTime).toISOString()).toBe(
        '2026-12-08T18:00:00.000Z',
      );

      const oldTable = await prisma.table.findUnique({ where: { id: tableIds[0] } });
      const newTable = await prisma.table.findUnique({ where: { id: tableIds[1] } });
      expect(oldTable?.status).toBe('Available');
      expect(newTable?.status).toBe('Available');

      const historyRow = await prisma.reservationHistory.findFirst({ where: { reservationId } });
      expect(historyRow).toMatchObject({
        oldTableId: tableIds[0],
        newTableId: tableIds[1],
      });
    });

    it('reschedules an Approved reservation to a different table - releases the old Table, reserves the new one', async () => {
      if (!dbAvailable) return;

      const owner = await registerAndLoginOwner('reschedule-approved-owner');
      const { restaurantId, branchId, tableIds } = await setUpRestaurantBranchTables(
        owner.accessToken,
        2,
      );
      const customer = await registerAndLoginCustomer('reschedule-approved-customer');
      const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);
      const reservationId = await createApprovedReservation(
        customer.accessToken,
        employee.accessToken,
        branchId,
        tableIds[0],
        {
          reservationStartTime: '2026-12-09T18:00:00.000Z',
          reservationEndTime: '2026-12-09T19:30:00.000Z',
        },
      );

      const response = await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/reschedule`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ tableId: tableIds[1] })
        .expect(200);

      expect(response.body.data.tableId).toBe(tableIds[1]);
      expect(response.body.data.status).toBe('Approved');

      const oldTable = await prisma.table.findUnique({ where: { id: tableIds[0] } });
      const newTable = await prisma.table.findUnique({ where: { id: tableIds[1] } });
      expect(oldTable?.status).toBe('Available');
      expect(newTable?.status).toBe('Reserved');
    });

    it('rejects reschedule once the cancellation window before the current scheduled time has closed', async () => {
      if (!dbAvailable) return;

      const owner = await registerAndLoginOwner('reschedule-window-owner');
      const { branchId, tableIds } = await setUpRestaurantBranchTables(owner.accessToken, 2);
      const customer = await registerAndLoginCustomer('reschedule-window-customer');
      const reservationId = await createPendingReservation(
        customer.accessToken,
        branchId,
        tableIds[0],
        {
          reservationStartTime: '2026-12-10T18:00:00.000Z',
          reservationEndTime: '2026-12-10T19:30:00.000Z',
        },
      );

      // Deterministically place the reservation inside the (default,
      // 60-minute) cancellation window - 30 minutes from now - rather than
      // waiting in real time.
      await prisma.reservation.update({
        where: { id: reservationId },
        data: {
          reservationStartTime: new Date(Date.now() + 30 * 60_000),
          reservationEndTime: new Date(Date.now() + 90 * 60_000),
        },
      });

      const response = await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/reschedule`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ tableId: tableIds[1] })
        .expect(409);
      expect(response.body.code).toBe('RESERVATION_RESCHEDULE_WINDOW_EXPIRED');
    });

    it('allows a branch-scoped Employee to reschedule, rejects one outside branch scope, and returns 401 unauthenticated', async () => {
      if (!dbAvailable) return;

      const owner = await registerAndLoginOwner('reschedule-employee-owner');
      const { restaurantId, branchId, tableIds } = await setUpRestaurantBranchTables(
        owner.accessToken,
        2,
      );
      const otherBranchResponse = await request(app!.getHttpServer())
        .post(`/api/v1/restaurants/${restaurantId}/branches`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          city: 'Aleppo',
          address: '789 Side St',
          countryCode: 'SY',
          timezone: 'Asia/Damascus',
        })
        .expect(201);
      const otherBranchId = otherBranchResponse.body.data.branchId as string;

      const customer = await registerAndLoginCustomer('reschedule-employee-customer');
      const scopedEmployee = await inviteAndLoginEmployee(owner.accessToken, restaurantId, [
        branchId,
      ]);
      const outOfScopeEmployee = await inviteAndLoginEmployee(owner.accessToken, restaurantId, [
        otherBranchId,
      ]);

      const reservationId = await createPendingReservation(
        customer.accessToken,
        branchId,
        tableIds[0],
        {
          reservationStartTime: '2026-12-11T18:00:00.000Z',
          reservationEndTime: '2026-12-11T19:30:00.000Z',
        },
      );

      await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/reschedule`)
        .expect(401);

      const outOfScopeResponse = await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/reschedule`)
        .set('Authorization', `Bearer ${outOfScopeEmployee.accessToken}`)
        .send({ tableId: tableIds[1] })
        .expect(403);
      expect(outOfScopeResponse.body.code).toBe('EMPLOYEE_BRANCH_NOT_ASSIGNED');

      const scopedResponse = await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/reschedule`)
        .set('Authorization', `Bearer ${scopedEmployee.accessToken}`)
        .send({ tableId: tableIds[1] })
        .expect(200);
      expect(scopedResponse.body.data.tableId).toBe(tableIds[1]);
    });
  });

  describe('Complete', () => {
    it('completes an Approved reservation once the service window has begun, releasing the Table to Available', async () => {
      if (!dbAvailable) return;

      const owner = await registerAndLoginOwner('complete-owner');
      const { restaurantId, branchId, tableIds } = await setUpRestaurantBranchTables(
        owner.accessToken,
      );
      const customer = await registerAndLoginCustomer('complete-customer');
      const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);
      const reservationId = await createApprovedReservation(
        customer.accessToken,
        employee.accessToken,
        branchId,
        tableIds[0],
        {
          reservationStartTime: '2026-12-12T18:00:00.000Z',
          reservationEndTime: '2026-12-12T19:30:00.000Z',
        },
      );
      await backdateToWithinServiceWindow(reservationId);

      const response = await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/complete`)
        .set('Authorization', `Bearer ${employee.accessToken}`)
        .expect(200);

      expect(response.body.data.status).toBe('Completed');
      expect(response.body.data.completedAt).not.toBeNull();

      const tableRow = await prisma.table.findUnique({ where: { id: tableIds[0] } });
      expect(tableRow?.status).toBe('Available');
    });

    it('rejects completing before the scheduled service window has begun', async () => {
      if (!dbAvailable) return;

      const owner = await registerAndLoginOwner('complete-early-owner');
      const { restaurantId, branchId, tableIds } = await setUpRestaurantBranchTables(
        owner.accessToken,
      );
      const customer = await registerAndLoginCustomer('complete-early-customer');
      const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);
      const reservationId = await createApprovedReservation(
        customer.accessToken,
        employee.accessToken,
        branchId,
        tableIds[0],
        {
          reservationStartTime: '2026-12-13T18:00:00.000Z',
          reservationEndTime: '2026-12-13T19:30:00.000Z',
        },
      );

      const response = await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/complete`)
        .set('Authorization', `Bearer ${employee.accessToken}`)
        .expect(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');

      const tableRow = await prisma.table.findUnique({ where: { id: tableIds[0] } });
      expect(tableRow?.status).toBe('Reserved');
    });

    it('returns 401 unauthenticated, 403 for a Customer actor, and 403 for an Employee outside branch scope', async () => {
      if (!dbAvailable) return;

      const owner = await registerAndLoginOwner('complete-authz-owner');
      const { restaurantId, branchId, tableIds } = await setUpRestaurantBranchTables(
        owner.accessToken,
      );
      const otherBranchResponse = await request(app!.getHttpServer())
        .post(`/api/v1/restaurants/${restaurantId}/branches`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          city: 'Aleppo',
          address: '321 Side St',
          countryCode: 'SY',
          timezone: 'Asia/Damascus',
        })
        .expect(201);
      const otherBranchId = otherBranchResponse.body.data.branchId as string;

      const customer = await registerAndLoginCustomer('complete-authz-customer');
      const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);
      const reservationId = await createApprovedReservation(
        customer.accessToken,
        employee.accessToken,
        branchId,
        tableIds[0],
        {
          reservationStartTime: '2026-12-14T18:00:00.000Z',
          reservationEndTime: '2026-12-14T19:30:00.000Z',
        },
      );
      await backdateToWithinServiceWindow(reservationId);

      await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/complete`)
        .expect(401);

      await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/complete`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(403);

      const outOfScopeEmployee = await inviteAndLoginEmployee(owner.accessToken, restaurantId, [
        otherBranchId,
      ]);
      const scopedResponse = await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/complete`)
        .set('Authorization', `Bearer ${outOfScopeEmployee.accessToken}`)
        .expect(403);
      expect(scopedResponse.body.code).toBe('EMPLOYEE_BRANCH_NOT_ASSIGNED');
    });
  });

  describe('No-Show', () => {
    it('marks an Approved reservation NoShow once the scheduled time has passed, releasing the Table to Available', async () => {
      if (!dbAvailable) return;

      const owner = await registerAndLoginOwner('no-show-owner');
      const { restaurantId, branchId, tableIds } = await setUpRestaurantBranchTables(
        owner.accessToken,
      );
      const customer = await registerAndLoginCustomer('no-show-customer');
      const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);
      const reservationId = await createApprovedReservation(
        customer.accessToken,
        employee.accessToken,
        branchId,
        tableIds[0],
        {
          reservationStartTime: '2026-12-15T18:00:00.000Z',
          reservationEndTime: '2026-12-15T19:30:00.000Z',
        },
      );
      await backdateToWithinServiceWindow(reservationId);

      const response = await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/no-show`)
        .set('Authorization', `Bearer ${employee.accessToken}`)
        .expect(200);

      expect(response.body.data.status).toBe('NoShow');
      expect(response.body.data.noShowAt).not.toBeNull();

      const tableRow = await prisma.table.findUnique({ where: { id: tableIds[0] } });
      expect(tableRow?.status).toBe('Available');
    });

    it('rejects marking NoShow before the scheduled time has passed', async () => {
      if (!dbAvailable) return;

      const owner = await registerAndLoginOwner('no-show-early-owner');
      const { restaurantId, branchId, tableIds } = await setUpRestaurantBranchTables(
        owner.accessToken,
      );
      const customer = await registerAndLoginCustomer('no-show-early-customer');
      const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);
      const reservationId = await createApprovedReservation(
        customer.accessToken,
        employee.accessToken,
        branchId,
        tableIds[0],
        {
          reservationStartTime: '2026-12-16T18:00:00.000Z',
          reservationEndTime: '2026-12-16T19:30:00.000Z',
        },
      );

      const response = await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/no-show`)
        .set('Authorization', `Bearer ${employee.accessToken}`)
        .expect(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });
});
