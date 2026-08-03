import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, RoleScope } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword, seedOwnerAndOrganization } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'merge-split-e2e-';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

/**
 * Phase 6 (Merge/Split Tables, ADR-026) e2e coverage: `POST /tables/merge`
 * and `POST /tables/:tableId/split`, plus the ripple effects Merge/Split has
 * on Availability Search (Phase 7.1), Reservation creation/approval (Phase
 * 7.1/7.2), and the Move/Status Domain Actions (Phase 6.2 / Status
 * Management) it must now reject while a table is part of an active merge
 * group (ADR-026 decisions #11/#13). Real Postgres, real HTTP, exactly like
 * `test/tables/tables.e2e-spec.ts` and `test/reservations/table-ready.e2e-spec.ts`.
 */
describe('Merge/Split Tables (ADR-026) (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let managerRoleId: string;
  let receptionistRoleId: string;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — merge/split e2e tests NOT EXECUTED.');
      return;
    }
    passwordHash = await hashTestPassword(PASSWORD);
    app = await createTestApp();

    // Real seeded slugs (prisma/seed.ts) - `manager` carries `tables:manage`
    // (and `reservations:approve`/`reservations:cancel`) via RolePermission
    // rows; `receptionist` carries neither `tables:manage` nor
    // `reservations:cancel`/`approve`-adjacent table-management rights, used
    // as the "missing permission" negative case below.
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

    const receptionist = await prisma.role.upsert({
      where: { slug: 'receptionist' },
      update: {},
      create: {
        name: 'Receptionist',
        slug: 'receptionist',
        description: 'Front-of-house reservation and guest management',
        scope: RoleScope.Restaurant,
      },
    });
    receptionistRoleId = receptionist.id;
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
      await prisma.organization.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  // -----------------------------------------------------------------------
  // Fixture helpers
  // -----------------------------------------------------------------------

  async function registerAndLoginOwner(
    suffix: string,
  ): Promise<{ accessToken: string; organizationId: string; userId: string; email: string }> {
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

    return {
      accessToken: loginResponse.body.data.accessToken as string,
      organizationId: loginResponse.body.data.organization.organizationId as string,
      userId,
      email,
    };
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

  async function createRestaurant(accessToken: string): Promise<string> {
    const response = await request(app!.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'The Merge Bistro', slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    return response.body.data.restaurantId as string;
  }

  async function createBranch(accessToken: string, restaurantId: string): Promise<string> {
    const response = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        city: 'Damascus',
        address: '123 Main St',
        countryCode: 'SY',
        timezone: 'Asia/Damascus',
      })
      .expect(201);
    return response.body.data.branchId as string;
  }

  async function createFloorPlan(
    accessToken: string,
    restaurantId: string,
    branchId: string,
    name = 'Main Floor',
  ): Promise<string> {
    const response = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches/${branchId}/floor-plans`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name })
      .expect(201);
    return response.body.data.floorPlanId as string;
  }

  async function createTable(
    accessToken: string,
    restaurantId: string,
    branchId: string,
    floorPlanId: string,
    tableNumber = 'T1',
    capacity = 4,
  ): Promise<string> {
    const response = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches/${branchId}/tables`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ floorPlanId, tableNumber, capacity })
      .expect(201);
    return response.body.data.tableId as string;
  }

  /** Owner + Restaurant + Branch + one active FloorPlan + `tableCount`
   * distinct 4-capacity tables (T1, T2, ...), each independently mergeable. */
  async function setUpWorld(
    suffix: string,
    tableCount = 2,
  ): Promise<{
    owner: { accessToken: string; organizationId: string; userId: string; email: string };
    restaurantId: string;
    branchId: string;
    floorPlanId: string;
    tableIds: string[];
  }> {
    const owner = await registerAndLoginOwner(suffix);
    const restaurantId = await createRestaurant(owner.accessToken);
    const branchId = await createBranch(owner.accessToken, restaurantId);
    const floorPlanId = await createFloorPlan(owner.accessToken, restaurantId, branchId);
    const tableIds: string[] = [];
    for (let i = 0; i < tableCount; i += 1) {
      tableIds.push(
        await createTable(owner.accessToken, restaurantId, branchId, floorPlanId, `T${i + 1}`, 4),
      );
    }
    return { owner, restaurantId, branchId, floorPlanId, tableIds };
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

  function mergeRequest(accessToken: string | null, tableIds: string[], primaryTableId?: string) {
    const req = request(app!.getHttpServer())
      .post('/api/v1/tables/merge')
      .send(primaryTableId ? { tableIds, primaryTableId } : { tableIds });
    return accessToken !== null ? req.set('Authorization', `Bearer ${accessToken}`) : req;
  }

  function splitRequest(accessToken: string | null, tableId: string) {
    const req = request(app!.getHttpServer()).post(`/api/v1/tables/${tableId}/split`).send({});
    return accessToken !== null ? req.set('Authorization', `Bearer ${accessToken}`) : req;
  }

  // -----------------------------------------------------------------------
  // Merge: success paths (Owner / Employee) + response shape
  // -----------------------------------------------------------------------

  it('Owner merges two Available tables (ids given in reverse order) - Primary auto-selected by lowest tableNumber', async () => {
    if (!dbAvailable || !app) return;

    const { owner, branchId, floorPlanId, tableIds } = await setUpWorld('merge-owner');
    const [t1, t2] = tableIds;

    const response = await mergeRequest(owner.accessToken, [t2, t1]).expect(200);

    expect(response.body.data.primaryTableId).toBe(t1);
    expect(response.body.data.memberTableIds.sort()).toEqual([t1, t2].sort());
    expect(response.body.data.effectiveCapacity).toBe(8);
    expect(response.body.data.mergeGroupId).toBeTruthy();
    expect(response.body.data.primary.tableId).toBe(t1);
    expect(response.body.data.primary.status).toBe('Available');
    expect(response.body.data.primary.isMergePrimary).toBe(true);
    expect(response.body.data.primary.mergeGroupId).toBe(response.body.data.mergeGroupId);

    const secondaryFromResponse = response.body.data.members.find(
      (m: { tableId: string }) => m.tableId === t2,
    );
    expect(secondaryFromResponse.status).toBe('Merged');
    expect(secondaryFromResponse.isMergePrimary).toBe(false);
    expect(secondaryFromResponse.mergeGroupId).toBe(response.body.data.mergeGroupId);

    const dbPrimary = await prisma.table.findUnique({ where: { id: t1 } });
    expect(dbPrimary?.status).toBe('Available');
    expect(dbPrimary?.isMergePrimary).toBe(true);
    expect(dbPrimary?.branchId).toBe(branchId);
    expect(dbPrimary?.floorPlanId).toBe(floorPlanId);

    const dbSecondary = await prisma.table.findUnique({ where: { id: t2 } });
    expect(dbSecondary?.status).toBe('Merged');
    expect(dbSecondary?.isMergePrimary).toBe(false);
    expect(dbSecondary?.mergeGroupId).toBe(dbPrimary?.mergeGroupId);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { targetId: t1, action: { contains: 'merge' } },
    });
    expect(auditEntry).not.toBeNull();
  });

  it('Employee holding tables:manage merges tables within their assigned branch, with an explicit primaryTableId', async () => {
    if (!dbAvailable || !app) return;

    const { owner, restaurantId, branchId, tableIds } = await setUpWorld('merge-employee');
    const [t1, t2] = tableIds;
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId, managerRoleId, [
      branchId,
    ]);

    const response = await mergeRequest(employee.accessToken, [t1, t2], t2).expect(200);

    expect(response.body.data.primaryTableId).toBe(t2);
    const dbPrimary = await prisma.table.findUnique({ where: { id: t2 } });
    expect(dbPrimary?.isMergePrimary).toBe(true);
    const dbSecondary = await prisma.table.findUnique({ where: { id: t1 } });
    expect(dbSecondary?.status).toBe('Merged');
  });

  it('an Employee restaurant-wide in scope (no explicit branch assignment) may also merge', async () => {
    if (!dbAvailable || !app) return;

    const { owner, restaurantId, tableIds } = await setUpWorld('merge-employee-wide');
    // No branchIds passed - assertActorCanManageTables treats an empty
    // branchIds array as restaurant-wide scope.
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId, managerRoleId);

    await mergeRequest(employee.accessToken, tableIds).expect(200);
  });

  // -----------------------------------------------------------------------
  // Merge: authorization negatives
  // -----------------------------------------------------------------------

  it('an Employee without tables:manage (Receptionist role) is forbidden (403 FORBIDDEN)', async () => {
    if (!dbAvailable || !app) return;

    const { owner, restaurantId, branchId, tableIds } = await setUpWorld('merge-no-perm');
    const employee = await inviteAndLoginEmployee(
      owner.accessToken,
      restaurantId,
      receptionistRoleId,
      [branchId],
    );

    const response = await mergeRequest(employee.accessToken, tableIds).expect(403);
    expect(response.body.code).toBe('FORBIDDEN');

    for (const tableId of tableIds) {
      const row = await prisma.table.findUnique({ where: { id: tableId } });
      expect(row?.status).toBe('Available');
      expect(row?.mergeGroupId).toBeNull();
    }
  });

  it('an Employee scoped to a different branch is forbidden (403 EMPLOYEE_BRANCH_NOT_ASSIGNED)', async () => {
    if (!dbAvailable || !app) return;

    const { owner, restaurantId, tableIds } = await setUpWorld('merge-wrong-branch');
    const otherBranchResponse = await request(app.getHttpServer())
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

    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId, managerRoleId, [
      otherBranchId,
    ]);

    const response = await mergeRequest(employee.accessToken, tableIds).expect(403);
    expect(response.body.code).toBe('EMPLOYEE_BRANCH_NOT_ASSIGNED');
  });

  it('a cross-organization OrganizationMember gets 404 (IDOR-safe collapse, not 403)', async () => {
    if (!dbAvailable || !app) return;

    const { tableIds } = await setUpWorld('merge-cross-org-a');
    const ownerB = await registerAndLoginOwner('merge-cross-org-b');

    const response = await mergeRequest(ownerB.accessToken, tableIds).expect(404);
    expect(response.body.code).toBe('NOT_FOUND');

    for (const tableId of tableIds) {
      const row = await prisma.table.findUnique({ where: { id: tableId } });
      expect(row?.mergeGroupId).toBeNull();
    }
  });

  it('unauthenticated Merge and Split both return 401', async () => {
    if (!dbAvailable || !app) return;

    const { owner, tableIds } = await setUpWorld('merge-unauth');

    await mergeRequest(null, tableIds).expect(401);

    // Split needs a real merge group to target - merge as the Owner first.
    await mergeRequest(owner.accessToken, tableIds).expect(200);
    await splitRequest(null, tableIds[0]).expect(401);
  });

  // -----------------------------------------------------------------------
  // Split: resolves the full group from ANY member id
  // -----------------------------------------------------------------------

  it('Split resolves the full group from the Primary id, restoring every member as independent', async () => {
    if (!dbAvailable || !app) return;

    const { owner, tableIds } = await setUpWorld('split-via-primary');
    const [t1, t2] = tableIds;
    const merged = await mergeRequest(owner.accessToken, [t1, t2], t1).expect(200);
    const mergeGroupId = merged.body.data.mergeGroupId as string;

    const response = await splitRequest(owner.accessToken, t1).expect(200);

    // The response's group-level fields describe the group that WAS just
    // dissolved (for reference/auditing) - primary/members reflect the new,
    // independent state.
    expect(response.body.data.mergeGroupId).toBe(mergeGroupId);
    expect(response.body.data.primaryTableId).toBe(t1);
    expect(response.body.data.primary.mergeGroupId).toBeNull();
    expect(response.body.data.primary.isMergePrimary).toBe(false);
    expect(response.body.data.primary.status).toBe('Available');
    const restoredSecondary = response.body.data.members.find(
      (m: { tableId: string }) => m.tableId === t2,
    );
    expect(restoredSecondary.mergeGroupId).toBeNull();
    expect(restoredSecondary.status).toBe('Available');

    const dbT1 = await prisma.table.findUnique({ where: { id: t1 } });
    const dbT2 = await prisma.table.findUnique({ where: { id: t2 } });
    expect(dbT1?.mergeGroupId).toBeNull();
    expect(dbT1?.isMergePrimary).toBe(false);
    expect(dbT1?.status).toBe('Available');
    expect(dbT2?.mergeGroupId).toBeNull();
    expect(dbT2?.status).toBe('Available');
  });

  it('Split resolves the full group from a Secondary id just as well', async () => {
    if (!dbAvailable || !app) return;

    const { owner, tableIds } = await setUpWorld('split-via-secondary');
    const [t1, t2] = tableIds;
    await mergeRequest(owner.accessToken, [t1, t2], t1).expect(200);

    // t2 is the Secondary here (t1 was selected Primary) - Split still
    // targets/restores the WHOLE group, keyed by the former Primary in the
    // response (ADR-026 decision #9).
    const response = await splitRequest(owner.accessToken, t2).expect(200);
    expect(response.body.data.primaryTableId).toBe(t1);

    const dbT1 = await prisma.table.findUnique({ where: { id: t1 } });
    const dbT2 = await prisma.table.findUnique({ where: { id: t2 } });
    expect(dbT1?.mergeGroupId).toBeNull();
    expect(dbT1?.status).toBe('Available');
    expect(dbT2?.mergeGroupId).toBeNull();
    expect(dbT2?.status).toBe('Available');
  });

  it('Splitting a table that is not currently merged returns 409 CONFLICT', async () => {
    if (!dbAvailable || !app) return;

    const { owner, tableIds } = await setUpWorld('split-not-merged', 1);

    const response = await splitRequest(owner.accessToken, tableIds[0]).expect(409);
    expect(response.body.code).toBe('CONFLICT');
  });

  // -----------------------------------------------------------------------
  // Merge: malformed requests / conflicting state
  // -----------------------------------------------------------------------

  it('rejects fewer than 2 table ids with a request-validation error (DTO-level ArrayMinSize)', async () => {
    if (!dbAvailable || !app) return;

    const { owner, tableIds } = await setUpWorld('merge-too-few', 1);

    const response = await mergeRequest(owner.accessToken, [tableIds[0]]).expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a duplicate table id (well-formed request, application-level check) with 400 VALIDATION_ERROR', async () => {
    if (!dbAvailable || !app) return;

    const { owner, tableIds } = await setUpWorld('merge-duplicate', 1);

    const response = await mergeRequest(owner.accessToken, [tableIds[0], tableIds[0]]).expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');

    const row = await prisma.table.findUnique({ where: { id: tableIds[0] } });
    expect(row?.mergeGroupId).toBeNull();
  });

  it('rejects tables spanning two different floor plans with 409 TABLE_MERGE_CONFLICT', async () => {
    if (!dbAvailable || !app) return;

    const { owner, restaurantId, branchId, tableIds } = await setUpWorld('merge-cross-floor', 1);
    const otherFloorPlanId = await createFloorPlan(
      owner.accessToken,
      restaurantId,
      branchId,
      'Patio',
    );
    const otherFloorTable = await createTable(
      owner.accessToken,
      restaurantId,
      branchId,
      otherFloorPlanId,
      'P1',
      4,
    );

    const response = await mergeRequest(owner.accessToken, [tableIds[0], otherFloorTable]).expect(
      409,
    );
    expect(response.body.code).toBe('TABLE_MERGE_CONFLICT');

    const row = await prisma.table.findUnique({ where: { id: tableIds[0] } });
    expect(row?.mergeGroupId).toBeNull();
  });

  it('rejects re-merging a table that is already part of an active merge group with 409 TABLE_MERGE_CONFLICT', async () => {
    if (!dbAvailable || !app) return;

    const { owner, restaurantId, branchId, floorPlanId, tableIds } = await setUpWorld(
      'merge-already-merged',
      2,
    );
    const [t1, t2] = tableIds;
    await mergeRequest(owner.accessToken, [t1, t2], t1).expect(200);

    const t3 = await createTable(owner.accessToken, restaurantId, branchId, floorPlanId, 'T3', 4);
    const response = await mergeRequest(owner.accessToken, [t2, t3]).expect(409);
    expect(response.body.code).toBe('TABLE_MERGE_CONFLICT');

    // t2 stayed exactly as it was (still merged with t1, not t3).
    const dbT2 = await prisma.table.findUnique({ where: { id: t2 } });
    expect(dbT2?.status).toBe('Merged');
    const dbT1 = await prisma.table.findUnique({ where: { id: t1 } });
    expect(dbT2?.mergeGroupId).toBe(dbT1?.mergeGroupId);
    const dbT3 = await prisma.table.findUnique({ where: { id: t3 } });
    expect(dbT3?.mergeGroupId).toBeNull();
  });

  it('rejects merging a table with a blocking Pending reservation (future reservationEndTime) with 409 TABLE_MERGE_CONFLICT', async () => {
    if (!dbAvailable || !app) return;

    const { owner, branchId, tableIds } = await setUpWorld('merge-blocked-pending');
    const [t1, t2] = tableIds;
    const customer = await registerAndLoginCustomer('merge-blocked-pending');

    await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({
        branchId,
        tableId: t1,
        reservationStartTime: '2026-12-15T18:00:00.000Z',
        reservationEndTime: '2026-12-15T19:30:00.000Z',
        guests: 2,
      })
      .expect(201);

    const response = await mergeRequest(owner.accessToken, [t1, t2]).expect(409);
    expect(response.body.code).toBe('TABLE_MERGE_CONFLICT');

    const row = await prisma.table.findUnique({ where: { id: t1 } });
    expect(row?.mergeGroupId).toBeNull();
    expect(row?.status).toBe('Available');
  });

  // -----------------------------------------------------------------------
  // Ripple effect: Availability Search (Phase 7.1)
  // -----------------------------------------------------------------------

  it('Availability Search: before merge no single 4-capacity table satisfies partySize 6; after merge the Primary is returned with the combined effectiveCapacity, the Secondary never appears', async () => {
    if (!dbAvailable || !app) return;

    const { owner, branchId, tableIds } = await setUpWorld('availability-merge');
    const [t1, t2] = tableIds;
    const customer = await registerAndLoginCustomer('availability-merge');

    const before = await request(app.getHttpServer())
      .get('/api/v1/reservations/availability')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .query({
        branchId,
        reservationStartTime: '2026-12-16T18:00:00.000Z',
        reservationEndTime: '2026-12-16T19:30:00.000Z',
        partySize: 6,
      })
      .expect(200);
    // Both T1/T2 individually cap at 4 - the Availability Search Contract
    // filters by minCapacity, so neither matches a party of 6 yet.
    expect(before.body.data).toEqual([]);

    await mergeRequest(owner.accessToken, [t1, t2], t1).expect(200);

    const after = await request(app.getHttpServer())
      .get('/api/v1/reservations/availability')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .query({
        branchId,
        reservationStartTime: '2026-12-16T18:00:00.000Z',
        reservationEndTime: '2026-12-16T19:30:00.000Z',
        partySize: 6,
      })
      .expect(200);

    expect(after.body.data).toHaveLength(1);
    expect(after.body.data[0].tableId).toBe(t1);
    expect(after.body.data[0].capacity).toBe(8);
    expect(after.body.data[0].isAvailable).toBe(true);
    // The Secondary (status Merged) is never a candidate - it is excluded
    // entirely, never merely marked unavailable.
    expect(after.body.data.some((row: { tableId: string }) => row.tableId === t2)).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Ripple effect: Reservation creation on the merged Primary (Phase 7.1)
  // -----------------------------------------------------------------------

  it('Reservation creation on the merged Primary honours the combined effectiveCapacity (partySize exceeding any single member but not the group)', async () => {
    if (!dbAvailable || !app) return;

    const { owner, branchId, tableIds } = await setUpWorld('reservation-merge-capacity');
    const [t1, t2] = tableIds;
    const customer = await registerAndLoginCustomer('reservation-merge-capacity');
    await mergeRequest(owner.accessToken, [t1, t2], t1).expect(200);

    // 6 guests exceeds T1's own permanent capacity (4) but not the merge
    // group's effectiveCapacity (8, ADR-026 decision #4/#14).
    const response = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({
        branchId,
        tableId: t1,
        reservationStartTime: '2026-12-17T18:00:00.000Z',
        reservationEndTime: '2026-12-17T19:30:00.000Z',
        guests: 6,
      })
      .expect(201);

    expect(response.body.data.tableId).toBe(t1);
    expect(response.body.data.guests).toBe(6);
  });

  it('the Secondary (status Merged) is never independently bookable - Create Reservation against it returns 409', async () => {
    if (!dbAvailable || !app) return;

    const { owner, branchId, tableIds } = await setUpWorld('reservation-secondary-blocked');
    const [t1, t2] = tableIds;
    const customer = await registerAndLoginCustomer('reservation-secondary-blocked');
    await mergeRequest(owner.accessToken, [t1, t2], t1).expect(200);

    const response = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({
        branchId,
        tableId: t2,
        reservationStartTime: '2026-12-18T18:00:00.000Z',
        reservationEndTime: '2026-12-18T19:30:00.000Z',
        guests: 2,
      })
      .expect(409);
    expect(response.body.code).toBe('CONFLICT');
  });

  // -----------------------------------------------------------------------
  // Ripple effect: Move / Status Domain Actions reject merged tables
  // -----------------------------------------------------------------------

  it('POST /tables/:tableId/move rejects a table currently part of an active merge group (400 VALIDATION_ERROR), leaving it untouched', async () => {
    if (!dbAvailable || !app) return;

    const { owner, restaurantId, branchId, floorPlanId, tableIds } =
      await setUpWorld('move-rejected-merged');
    const [t1] = tableIds;
    const patioFloorPlanId = await createFloorPlan(
      owner.accessToken,
      restaurantId,
      branchId,
      'Patio',
    );
    await mergeRequest(owner.accessToken, tableIds, t1).expect(200);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/tables/${t1}/move`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ targetFloorPlanId: patioFloorPlanId })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');

    const row = await prisma.table.findUnique({ where: { id: t1 } });
    expect(row?.floorPlanId).toBe(floorPlanId);
    expect(row?.mergeGroupId).not.toBeNull();
  });

  it('POST /tables/:tableId/status rejects a table currently part of an active merge group (400 VALIDATION_ERROR), leaving it untouched', async () => {
    if (!dbAvailable || !app) return;

    const { owner, tableIds } = await setUpWorld('status-rejected-merged');
    const [t1] = tableIds;
    await mergeRequest(owner.accessToken, tableIds, t1).expect(200);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/tables/${t1}/status`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ status: 'Occupied' })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');

    const row = await prisma.table.findUnique({ where: { id: t1 } });
    expect(row?.status).toBe('Available');
    expect(row?.mergeGroupId).not.toBeNull();
  });

  // -----------------------------------------------------------------------
  // Full lifecycle: Approve on merged Primary -> blocked Split -> release -> Split
  // -----------------------------------------------------------------------

  it('Approving a reservation on the merged Primary transitions ONLY the Primary to Reserved (Secondary stays Merged); Split is then blocked until the reservation is released, and succeeds immediately after', async () => {
    if (!dbAvailable || !app) return;

    const { owner, restaurantId, branchId, tableIds } = await setUpWorld('approve-merge-lifecycle');
    const [t1, t2] = tableIds;
    const customer = await registerAndLoginCustomer('approve-merge-lifecycle');
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId, managerRoleId, [
      branchId,
    ]);

    await mergeRequest(owner.accessToken, [t1, t2], t1).expect(200);

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({
        branchId,
        tableId: t1,
        reservationStartTime: '2026-12-19T18:00:00.000Z',
        reservationEndTime: '2026-12-19T19:30:00.000Z',
        guests: 6,
      })
      .expect(201);
    const reservationId = createResponse.body.data.reservationId as string;

    const approveResponse = await request(app.getHttpServer())
      .post(`/api/v1/reservations/${reservationId}/approve`)
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .expect(200);
    expect(approveResponse.body.data.status).toBe('Approved');

    const dbPrimaryAfterApprove = await prisma.table.findUnique({ where: { id: t1 } });
    expect(dbPrimaryAfterApprove?.status).toBe('Reserved');
    expect(dbPrimaryAfterApprove?.mergeGroupId).not.toBeNull();
    const dbSecondaryAfterApprove = await prisma.table.findUnique({ where: { id: t2 } });
    expect(dbSecondaryAfterApprove?.status).toBe('Merged');
    expect(dbSecondaryAfterApprove?.mergeGroupId).toBe(dbPrimaryAfterApprove?.mergeGroupId);

    // Split blocked: the Primary has a still-Approved, not-yet-ended
    // reservation (ADR-026 decision #6 - Split blocks on the PRIMARY only).
    const blockedSplit = await splitRequest(owner.accessToken, t1).expect(409);
    expect(blockedSplit.body.code).toBe('TABLE_MERGE_CONFLICT');

    // Release: Cancel is reachable regardless of the cancellation window and
    // calls Table.release() atomically, returning the Primary to Available.
    await request(app.getHttpServer())
      .post(`/api/v1/reservations/${reservationId}/cancel`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({})
      .expect(200);

    const dbPrimaryAfterCancel = await prisma.table.findUnique({ where: { id: t1 } });
    expect(dbPrimaryAfterCancel?.status).toBe('Available');
    expect(dbPrimaryAfterCancel?.mergeGroupId).not.toBeNull();

    // Split after release now succeeds.
    const splitResponse = await splitRequest(owner.accessToken, t1).expect(200);
    expect(splitResponse.body.data.primary.status).toBe('Available');
    expect(splitResponse.body.data.primary.mergeGroupId).toBeNull();

    const dbT1Final = await prisma.table.findUnique({ where: { id: t1 } });
    const dbT2Final = await prisma.table.findUnique({ where: { id: t2 } });
    expect(dbT1Final?.mergeGroupId).toBeNull();
    expect(dbT1Final?.status).toBe('Available');
    expect(dbT2Final?.mergeGroupId).toBeNull();
    expect(dbT2Final?.status).toBe('Available');
  });
});
