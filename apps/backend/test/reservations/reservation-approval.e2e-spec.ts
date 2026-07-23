import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, RoleScope } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword, seedOwnerAndOrganization } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'reservation-approval-e2e-';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

/**
 * Phase 7.2 (Approval Workflow) e2e coverage: Approve/Reject
 * (`POST /reservations/:id/approve|reject`), auto-approval
 * (`RestaurantSettings.autoApproval`), Employee/`reservations:approve`
 * authorization + branch scope, and regression coverage for Phase 7.1's
 * Create/Availability contract.
 */
describe('/api/v1/reservations/:id/approve|reject (e2e, Phase 7.2)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let managerRoleId: string;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — reservation approval e2e tests NOT EXECUTED.');
      return;
    }
    passwordHash = await hashTestPassword(PASSWORD);
    app = await createTestApp();

    // Same real seeded `manager` slug precedent as employees.e2e-spec.ts -
    // already carries `reservations:approve` via `prisma/seed.ts`'s
    // RolePermission rows, not recreated here.
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

  /**
   * Registers a second person (as Owner of an unrelated organization, purely
   * to obtain a password-authenticated User account - same convention as
   * `employees.e2e-spec.ts`'s "links a pre-created Invited employee" test),
   * invites them as an Employee at the target restaurant, optionally assigns
   * them to specific branches, then logs them in again - triggering
   * first-login linking (Phase 7.0) and producing a real Employee-actor JWT
   * (`AccessTokenClaimsBuilder`'s Employee > OrganizationMember precedence).
   */
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
        reservationStartTime: overrides.reservationStartTime ?? '2026-11-01T18:00:00.000Z',
        reservationEndTime: overrides.reservationEndTime ?? '2026-11-01T19:30:00.000Z',
        guests: 2,
      })
      .expect(201);
    return response.body.data.reservationId as string;
  }

  describe('Approve', () => {
    it('approves a Pending reservation: Reservation becomes Approved, Table becomes Reserved, approvedBy/approvedAt set, audited', async () => {
      if (!dbAvailable) return;

      const owner = await registerAndLoginOwner('approve-owner');
      const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(
        owner.accessToken,
      );
      const customer = await registerAndLoginOwner('approve-customer');
      const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);
      const reservationId = await createPendingReservation(customer.accessToken, branchId, tableId);

      const response = await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/approve`)
        .set('Authorization', `Bearer ${employee.accessToken}`)
        .expect(200);

      expect(response.body.data.status).toBe('Approved');
      expect(response.body.data.approvedBy).toBe(employee.employeeId);
      expect(response.body.data.approvedAt).not.toBeNull();

      const tableRow = await prisma.table.findUnique({ where: { id: tableId } });
      expect(tableRow?.status).toBe('Reserved');

      const auditRow = await prisma.auditLog.findFirst({
        where: { targetId: reservationId, action: 'reservation.approved' },
      });
      expect(auditRow).not.toBeNull();
      expect(auditRow?.actorType).toBe('Employee');
      expect(auditRow?.actorId).toBe(employee.employeeId);
    });

    it('auto-rejects an overlapping Pending reservation for the same table, without altering the Table (still Reserved by the approved one)', async () => {
      if (!dbAvailable) return;

      const owner = await registerAndLoginOwner('auto-reject-owner');
      const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(
        owner.accessToken,
      );
      const customerA = await registerAndLoginOwner('auto-reject-a');
      const customerB = await registerAndLoginOwner('auto-reject-b');
      const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);

      const reservationA = await createPendingReservation(
        customerA.accessToken,
        branchId,
        tableId,
        {
          reservationStartTime: '2026-11-02T18:00:00.000Z',
          reservationEndTime: '2026-11-02T19:30:00.000Z',
        },
      );
      const reservationB = await createPendingReservation(
        customerB.accessToken,
        branchId,
        tableId,
        {
          reservationStartTime: '2026-11-02T18:30:00.000Z',
          reservationEndTime: '2026-11-02T20:00:00.000Z',
        },
      );

      await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationA}/approve`)
        .set('Authorization', `Bearer ${employee.accessToken}`)
        .expect(200);

      const reservationBRow = await prisma.reservation.findUnique({
        where: { id: reservationB },
      });
      expect(reservationBRow?.status).toBe('Rejected');
      expect(reservationBRow?.notes ?? '').toMatch(/Automatically rejected/);

      const tableRow = await prisma.table.findUnique({ where: { id: tableId } });
      expect(tableRow?.status).toBe('Reserved');

      const autoRejectAuditRow = await prisma.auditLog.findFirst({
        where: { targetId: reservationB, action: 'reservation.rejected' },
      });
      expect(autoRejectAuditRow).not.toBeNull();
      expect(autoRejectAuditRow?.actorType).toBe('System');
      expect(autoRejectAuditRow?.actorId).toBeNull();
    });

    it('rejects approving a reservation that is already Approved (repeated approve)', async () => {
      if (!dbAvailable) return;

      const owner = await registerAndLoginOwner('repeat-approve-owner');
      const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(
        owner.accessToken,
      );
      const customer = await registerAndLoginOwner('repeat-approve-customer');
      const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);
      const reservationId = await createPendingReservation(
        customer.accessToken,
        branchId,
        tableId,
        {
          reservationStartTime: '2026-11-03T18:00:00.000Z',
          reservationEndTime: '2026-11-03T19:30:00.000Z',
        },
      );

      await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/approve`)
        .set('Authorization', `Bearer ${employee.accessToken}`)
        .expect(200);

      const response = await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/approve`)
        .set('Authorization', `Bearer ${employee.accessToken}`)
        .expect(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 for an unknown reservation and for one belonging to a different restaurant (IDOR)', async () => {
      if (!dbAvailable) return;

      const ownerA = await registerAndLoginOwner('idor-approve-a');
      const { restaurantId: restaurantA } = await setUpRestaurantBranchTable(ownerA.accessToken);
      const employeeA = await inviteAndLoginEmployee(ownerA.accessToken, restaurantA);

      const unknown = await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${randomUUID()}/approve`)
        .set('Authorization', `Bearer ${employeeA.accessToken}`)
        .expect(404);
      expect(unknown.body.code).toBe('NOT_FOUND');

      const ownerB = await registerAndLoginOwner('idor-approve-b');
      const { branchId: branchB, tableId: tableB } = await setUpRestaurantBranchTable(
        ownerB.accessToken,
      );
      const customerB = await registerAndLoginOwner('idor-approve-customer-b');
      const reservationB = await createPendingReservation(customerB.accessToken, branchB, tableB, {
        reservationStartTime: '2026-11-04T18:00:00.000Z',
        reservationEndTime: '2026-11-04T19:30:00.000Z',
      });

      const crossTenant = await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationB}/approve`)
        .set('Authorization', `Bearer ${employeeA.accessToken}`)
        .expect(404);
      expect(crossTenant.body.code).toBe('NOT_FOUND');
    });

    it('returns 401 unauthenticated, 403 for a Customer actor, and 403 for an Employee outside branch scope', async () => {
      if (!dbAvailable) return;

      const owner = await registerAndLoginOwner('authz-owner');
      const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(
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

      const customer = await registerAndLoginOwner('authz-customer');
      const reservationId = await createPendingReservation(
        customer.accessToken,
        branchId,
        tableId,
        {
          reservationStartTime: '2026-11-05T18:00:00.000Z',
          reservationEndTime: '2026-11-05T19:30:00.000Z',
        },
      );

      await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/approve`)
        .expect(401);

      await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/approve`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(403);

      const scopedEmployee = await inviteAndLoginEmployee(owner.accessToken, restaurantId, [
        otherBranchId,
      ]);
      const scopedResponse = await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/approve`)
        .set('Authorization', `Bearer ${scopedEmployee.accessToken}`)
        .expect(403);
      expect(scopedResponse.body.code).toBe('EMPLOYEE_BRANCH_NOT_ASSIGNED');
    });
  });

  describe('Reject', () => {
    it('rejects a Pending reservation: Reservation becomes Rejected, Table remains unchanged (never Reserved), audited', async () => {
      if (!dbAvailable) return;

      const owner = await registerAndLoginOwner('reject-owner');
      const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(
        owner.accessToken,
      );
      const customer = await registerAndLoginOwner('reject-customer');
      const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);
      const reservationId = await createPendingReservation(
        customer.accessToken,
        branchId,
        tableId,
        {
          reservationStartTime: '2026-11-06T18:00:00.000Z',
          reservationEndTime: '2026-11-06T19:30:00.000Z',
        },
      );

      const response = await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/reject`)
        .set('Authorization', `Bearer ${employee.accessToken}`)
        .expect(200);

      expect(response.body.data.status).toBe('Rejected');

      const tableRow = await prisma.table.findUnique({ where: { id: tableId } });
      expect(tableRow?.status).toBe('Available');

      const auditRow = await prisma.auditLog.findFirst({
        where: { targetId: reservationId, action: 'reservation.rejected' },
      });
      expect(auditRow).not.toBeNull();
      expect(auditRow?.actorType).toBe('Employee');
      expect(auditRow?.actorId).toBe(employee.employeeId);
    });

    it('rejects rejecting a reservation that is already Rejected (repeated reject)', async () => {
      if (!dbAvailable) return;

      const owner = await registerAndLoginOwner('repeat-reject-owner');
      const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(
        owner.accessToken,
      );
      const customer = await registerAndLoginOwner('repeat-reject-customer');
      const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);
      const reservationId = await createPendingReservation(
        customer.accessToken,
        branchId,
        tableId,
        {
          reservationStartTime: '2026-11-07T18:00:00.000Z',
          reservationEndTime: '2026-11-07T19:30:00.000Z',
        },
      );

      await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/reject`)
        .set('Authorization', `Bearer ${employee.accessToken}`)
        .expect(200);

      const response = await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/reject`)
        .set('Authorization', `Bearer ${employee.accessToken}`)
        .expect(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects rejecting an Approved reservation (state machine: reject non-Pending)', async () => {
      if (!dbAvailable) return;

      const owner = await registerAndLoginOwner('reject-approved-owner');
      const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(
        owner.accessToken,
      );
      const customer = await registerAndLoginOwner('reject-approved-customer');
      const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId);
      const reservationId = await createPendingReservation(
        customer.accessToken,
        branchId,
        tableId,
        {
          reservationStartTime: '2026-11-08T18:00:00.000Z',
          reservationEndTime: '2026-11-08T19:30:00.000Z',
        },
      );

      await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/approve`)
        .set('Authorization', `Bearer ${employee.accessToken}`)
        .expect(200);

      const response = await request(app!.getHttpServer())
        .post(`/api/v1/reservations/${reservationId}/reject`)
        .set('Authorization', `Bearer ${employee.accessToken}`)
        .expect(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');

      const tableRow = await prisma.table.findUnique({ where: { id: tableId } });
      expect(tableRow?.status).toBe('Reserved');
    });
  });

  describe('Auto-approval (RestaurantSettings.autoApproval = true)', () => {
    async function enableAutoApproval(
      ownerAccessToken: string,
      restaurantId: string,
    ): Promise<void> {
      const current = await request(app!.getHttpServer())
        .get(`/api/v1/restaurants/${restaurantId}/settings`)
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .expect(200);

      await request(app!.getHttpServer())
        .patch(`/api/v1/restaurants/${restaurantId}/settings`)
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .send({
          reservationIntervalMinutes: current.body.data.reservationIntervalMinutes,
          maxGuestsPerReservation: current.body.data.maxGuestsPerReservation,
          cancellationWindowMinutes: current.body.data.cancellationWindowMinutes,
          pendingReservationTimeoutMinutes: current.body.data.pendingReservationTimeoutMinutes,
          defaultReservationDurationMinutes: current.body.data.defaultReservationDurationMinutes,
          autoApproval: true,
          timezone: current.body.data.timezone,
          defaultCurrency: current.body.data.defaultCurrency,
        })
        .expect(200);
    }

    it('creates the reservation directly as Approved with the Table Reserved - no intermediate Pending', async () => {
      if (!dbAvailable) return;

      const owner = await registerAndLoginOwner('auto-approve-owner');
      const { restaurantId, branchId, tableId } = await setUpRestaurantBranchTable(
        owner.accessToken,
      );
      await enableAutoApproval(owner.accessToken, restaurantId);
      const customer = await registerAndLoginOwner('auto-approve-customer');

      const response = await request(app!.getHttpServer())
        .post('/api/v1/reservations')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({
          branchId,
          tableId,
          reservationStartTime: '2026-11-09T18:00:00.000Z',
          reservationEndTime: '2026-11-09T19:30:00.000Z',
          guests: 2,
        })
        .expect(201);

      expect(response.body.data.status).toBe('Approved');

      const tableRow = await prisma.table.findUnique({ where: { id: tableId } });
      expect(tableRow?.status).toBe('Reserved');

      const reservationRow = await prisma.reservation.findUnique({
        where: { id: response.body.data.reservationId },
      });
      expect(reservationRow?.status).toBe('Approved');
      expect(reservationRow?.approvedBy).toBeNull();
    });

    it('regression: autoApproval=false (default) still creates Pending and leaves the Table Available', async () => {
      if (!dbAvailable) return;

      const owner = await registerAndLoginOwner('no-auto-approve-owner');
      const { branchId, tableId } = await setUpRestaurantBranchTable(owner.accessToken);
      const customer = await registerAndLoginOwner('no-auto-approve-customer');

      const response = await request(app!.getHttpServer())
        .post('/api/v1/reservations')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({
          branchId,
          tableId,
          reservationStartTime: '2026-11-10T18:00:00.000Z',
          reservationEndTime: '2026-11-10T19:30:00.000Z',
          guests: 2,
        })
        .expect(201);

      expect(response.body.data.status).toBe('Pending');

      const tableRow = await prisma.table.findUnique({ where: { id: tableId } });
      expect(tableRow?.status).toBe('Available');
    });
  });
});
