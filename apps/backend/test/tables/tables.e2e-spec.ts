import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'table-e2e-';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

describe('Table Module (FloorPlan + Table) (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — tables e2e tests NOT EXECUTED.');
      return;
    }
    app = await createTestApp();
  });

  afterAll(async () => {
    if (dbAvailable) {
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

  async function registerAndLoginOwner(
    suffix: string,
  ): Promise<{ accessToken: string; organizationId: string; userId: string }> {
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

    return {
      accessToken: loginResponse.body.data.accessToken as string,
      organizationId: loginResponse.body.data.organization.organizationId as string,
      userId,
    };
  }

  async function createRestaurant(accessToken: string): Promise<string> {
    const response = await request(app!.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'The Old Mill', slug: `${TEST_PREFIX}${uniqueId()}` })
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
  ): Promise<{ floorPlanId: string; isActive: boolean }> {
    const response = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches/${branchId}/floor-plans`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name })
      .expect(201);
    return {
      floorPlanId: response.body.data.floorPlanId as string,
      isActive: response.body.data.isActive as boolean,
    };
  }

  async function createTable(
    accessToken: string,
    restaurantId: string,
    branchId: string,
    floorPlanId: string,
    tableNumber = 'T1',
  ): Promise<string> {
    const response = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches/${branchId}/tables`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ floorPlanId, tableNumber, capacity: 4 })
      .expect(201);
    return response.body.data.tableId as string;
  }

  // ---------------------------------------------------------------------
  // FloorPlan: Create / List / Activate
  // ---------------------------------------------------------------------

  it('POST creates the first floor plan of a branch as active automatically', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('fp-create');
    const restaurantId = await createRestaurant(owner.accessToken);
    const branchId = await createBranch(owner.accessToken, restaurantId);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches/${branchId}/floor-plans`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Main Floor' })
      .expect(201);

    expect(response.body.data.isActive).toBe(true);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { targetId: response.body.data.floorPlanId, action: 'floor_plan.created' },
    });
    expect(auditEntry).not.toBeNull();
  });

  it('POST creates a second floor plan of the same branch as inactive', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('fp-second');
    const restaurantId = await createRestaurant(owner.accessToken);
    const branchId = await createBranch(owner.accessToken, restaurantId);
    await createFloorPlan(owner.accessToken, restaurantId, branchId, 'Main Floor');

    const second = await createFloorPlan(owner.accessToken, restaurantId, branchId, 'Patio');
    expect(second.isActive).toBe(false);
  });

  it('GET lists every floor plan of the branch', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('fp-list');
    const restaurantId = await createRestaurant(owner.accessToken);
    const branchId = await createBranch(owner.accessToken, restaurantId);
    await createFloorPlan(owner.accessToken, restaurantId, branchId, 'Main Floor');
    await createFloorPlan(owner.accessToken, restaurantId, branchId, 'Patio');

    const response = await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/branches/${branchId}/floor-plans`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect(response.body.data.items).toHaveLength(2);
  });

  it('PATCH .../activate atomically deactivates the previously active floor plan', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('fp-activate');
    const restaurantId = await createRestaurant(owner.accessToken);
    const branchId = await createBranch(owner.accessToken, restaurantId);
    const main = await createFloorPlan(owner.accessToken, restaurantId, branchId, 'Main Floor');
    const patio = await createFloorPlan(owner.accessToken, restaurantId, branchId, 'Patio');

    const response = await request(app.getHttpServer())
      .patch(
        `/api/v1/restaurants/${restaurantId}/branches/${branchId}/floor-plans/${patio.floorPlanId}/activate`,
      )
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(response.body.data.isActive).toBe(true);

    const activeCount = await prisma.floorPlan.count({
      where: { branchId, isActive: true, deletedAt: null },
    });
    expect(activeCount).toBe(1);

    const mainRow = await prisma.floorPlan.findUnique({ where: { id: main.floorPlanId } });
    expect(mainRow?.isActive).toBe(false);
  });

  it('PATCH .../activate on an unknown floor plan returns 404', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('fp-activate-404');
    const restaurantId = await createRestaurant(owner.accessToken);
    const branchId = await createBranch(owner.accessToken, restaurantId);

    await request(app.getHttpServer())
      .patch(
        `/api/v1/restaurants/${restaurantId}/branches/${branchId}/floor-plans/${randomUUID()}/activate`,
      )
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(404);
  });

  // ---------------------------------------------------------------------
  // Table: Create / Update / List by branch / List by floor plan / Get / Delete
  // ---------------------------------------------------------------------

  it('POST creates a table always with status Available and rejects a duplicate tableNumber', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('t-create');
    const restaurantId = await createRestaurant(owner.accessToken);
    const branchId = await createBranch(owner.accessToken, restaurantId);
    const floorPlan = await createFloorPlan(owner.accessToken, restaurantId, branchId);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches/${branchId}/tables`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ floorPlanId: floorPlan.floorPlanId, tableNumber: 'T1', capacity: 4 })
      .expect(201);

    expect(response.body.data.status).toBe('Available');
    expect(response.body.data.mergeGroupId).toBeNull();

    await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches/${branchId}/tables`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ floorPlanId: floorPlan.floorPlanId, tableNumber: 'T1', capacity: 2 })
      .expect(409);
  });

  it('POST rejects a floorPlanId that does not belong to the branch with 404', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('t-fp-404');
    const restaurantId = await createRestaurant(owner.accessToken);
    const branchId = await createBranch(owner.accessToken, restaurantId);

    await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches/${branchId}/tables`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ floorPlanId: randomUUID(), tableNumber: 'T1', capacity: 4 })
      .expect(404);
  });

  it('GET .../tables lists tables of the branch', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('t-list-branch');
    const restaurantId = await createRestaurant(owner.accessToken);
    const branchId = await createBranch(owner.accessToken, restaurantId);
    const floorPlan = await createFloorPlan(owner.accessToken, restaurantId, branchId);
    await createTable(owner.accessToken, restaurantId, branchId, floorPlan.floorPlanId, 'T1');
    await createTable(owner.accessToken, restaurantId, branchId, floorPlan.floorPlanId, 'T2');

    const response = await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/branches/${branchId}/tables`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect(response.body.data.total).toBe(2);
  });

  it('GET .../floor-plans/:floorPlanId/tables lists only that floor plan’s tables', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('t-list-fp');
    const restaurantId = await createRestaurant(owner.accessToken);
    const branchId = await createBranch(owner.accessToken, restaurantId);
    const floorPlanA = await createFloorPlan(owner.accessToken, restaurantId, branchId, 'Main');
    const floorPlanB = await createFloorPlan(owner.accessToken, restaurantId, branchId, 'Patio');
    await createTable(owner.accessToken, restaurantId, branchId, floorPlanA.floorPlanId, 'T1');
    await createTable(owner.accessToken, restaurantId, branchId, floorPlanB.floorPlanId, 'T2');

    const response = await request(app.getHttpServer())
      .get(
        `/api/v1/restaurants/${restaurantId}/branches/${branchId}/floor-plans/${floorPlanA.floorPlanId}/tables`,
      )
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect(response.body.data.total).toBe(1);
    expect(response.body.data.items[0].tableNumber).toBe('T1');
  });

  it('GET /tables/:tableId retrieves a table via the flat route', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('t-get');
    const restaurantId = await createRestaurant(owner.accessToken);
    const branchId = await createBranch(owner.accessToken, restaurantId);
    const floorPlan = await createFloorPlan(owner.accessToken, restaurantId, branchId);
    const tableId = await createTable(
      owner.accessToken,
      restaurantId,
      branchId,
      floorPlan.floorPlanId,
    );

    const response = await request(app.getHttpServer())
      .get(`/api/v1/tables/${tableId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect(response.body.data.tableId).toBe(tableId);
  });

  it('PATCH /tables/:tableId full-replaces profile fields but never status', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('t-update');
    const restaurantId = await createRestaurant(owner.accessToken);
    const branchId = await createBranch(owner.accessToken, restaurantId);
    const floorPlan = await createFloorPlan(owner.accessToken, restaurantId, branchId);
    const tableId = await createTable(
      owner.accessToken,
      restaurantId,
      branchId,
      floorPlan.floorPlanId,
    );

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/tables/${tableId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ tableNumber: 'T1', capacity: 8, shape: 'Round', vip: true })
      .expect(200);

    expect(response.body.data.capacity).toBe(8);
    expect(response.body.data.shape).toBe('Round');
    expect(response.body.data.vip).toBe(true);
    expect(response.body.data.status).toBe('Available');

    const auditRelatedEvent = await prisma.auditLog.findFirst({
      where: { targetId: tableId, action: 'table.updated' },
    });
    expect(auditRelatedEvent).not.toBeNull();
  });

  it('POST /tables/:tableId/move reassigns floorPlanId only, produces an audit log, and rejects invalid targets', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('t-move');
    const restaurantId = await createRestaurant(owner.accessToken);
    const branchId = await createBranch(owner.accessToken, restaurantId);
    const branchB = await createBranch(owner.accessToken, restaurantId);
    const mainFloor = await createFloorPlan(
      owner.accessToken,
      restaurantId,
      branchId,
      'Main Floor',
    );
    const patio = await createFloorPlan(owner.accessToken, restaurantId, branchId, 'Patio');
    const otherBranchFloor = await createFloorPlan(
      owner.accessToken,
      restaurantId,
      branchB,
      'Other Branch Floor',
    );
    const tableId = await createTable(
      owner.accessToken,
      restaurantId,
      branchId,
      mainFloor.floorPlanId,
    );

    // Successful move: only floorPlanId changes.
    const moved = await request(app.getHttpServer())
      .post(`/api/v1/tables/${tableId}/move`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ targetFloorPlanId: patio.floorPlanId })
      .expect(200);
    expect(moved.body.data.floorPlanId).toBe(patio.floorPlanId);
    expect(moved.body.data.tableNumber).toBe('T1');
    expect(moved.body.data.capacity).toBe(4);
    expect(moved.body.data.status).toBe('Available');

    const auditEntry = await prisma.auditLog.findFirst({
      where: { targetId: tableId, action: 'table.moved' },
    });
    expect(auditEntry).not.toBeNull();

    // Reject: unknown floor plan.
    await request(app.getHttpServer())
      .post(`/api/v1/tables/${tableId}/move`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ targetFloorPlanId: randomUUID() })
      .expect(404);

    // Reject: floor plan belonging to a different branch (cross-branch move).
    await request(app.getHttpServer())
      .post(`/api/v1/tables/${tableId}/move`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ targetFloorPlanId: otherBranchFloor.floorPlanId })
      .expect(404);

    // Reject: soft-deleted floor plan target.
    await prisma.floorPlan.update({
      where: { id: mainFloor.floorPlanId },
      data: { deletedAt: new Date() },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/tables/${tableId}/move`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ targetFloorPlanId: mainFloor.floorPlanId })
      .expect(404);

    // Table stayed at the last successful target (Patio), untouched by the
    // three rejected attempts.
    const row = await prisma.table.findUnique({ where: { id: tableId } });
    expect(row?.floorPlanId).toBe(patio.floorPlanId);
  });

  it('POST /tables/:tableId/move from another organization returns 404 (cross-org IDOR)', async () => {
    if (!dbAvailable || !app) return;

    const ownerA = await registerAndLoginOwner('t-move-iso-a');
    const ownerB = await registerAndLoginOwner('t-move-iso-b');
    const restaurantId = await createRestaurant(ownerA.accessToken);
    const branchId = await createBranch(ownerA.accessToken, restaurantId);
    const mainFloor = await createFloorPlan(ownerA.accessToken, restaurantId, branchId, 'Main');
    const patio = await createFloorPlan(ownerA.accessToken, restaurantId, branchId, 'Patio');
    const tableId = await createTable(
      ownerA.accessToken,
      restaurantId,
      branchId,
      mainFloor.floorPlanId,
    );

    await request(app.getHttpServer())
      .post(`/api/v1/tables/${tableId}/move`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({ targetFloorPlanId: patio.floorPlanId })
      .expect(404);

    const row = await prisma.table.findUnique({ where: { id: tableId } });
    expect(row?.floorPlanId).toBe(mainFloor.floorPlanId);
  });

  it('POST /tables/:tableId/status transitions Available <-> Occupied/Cleaning/Disabled and produces an audit log', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('t-status');
    const restaurantId = await createRestaurant(owner.accessToken);
    const branchId = await createBranch(owner.accessToken, restaurantId);
    const floorPlan = await createFloorPlan(owner.accessToken, restaurantId, branchId);
    const tableId = await createTable(
      owner.accessToken,
      restaurantId,
      branchId,
      floorPlan.floorPlanId,
    );

    const toOccupied = await request(app.getHttpServer())
      .post(`/api/v1/tables/${tableId}/status`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ status: 'Occupied' })
      .expect(200);
    expect(toOccupied.body.data.status).toBe('Occupied');

    const auditEntry = await prisma.auditLog.findFirst({
      where: { targetId: tableId, action: 'table.status_changed' },
    });
    expect(auditEntry).not.toBeNull();

    await request(app.getHttpServer())
      .post(`/api/v1/tables/${tableId}/status`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ status: 'Available' })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/tables/${tableId}/status`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ status: 'Cleaning' })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/tables/${tableId}/status`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ status: 'Available' })
      .expect(200);

    const toDisabled = await request(app.getHttpServer())
      .post(`/api/v1/tables/${tableId}/status`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ status: 'Disabled' })
      .expect(200);
    expect(toDisabled.body.data.status).toBe('Disabled');
  });

  it('POST /tables/:tableId/status rejects forbidden transitions and same-status "transitions"', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('t-status-invalid');
    const restaurantId = await createRestaurant(owner.accessToken);
    const branchId = await createBranch(owner.accessToken, restaurantId);
    const floorPlan = await createFloorPlan(owner.accessToken, restaurantId, branchId);
    const tableId = await createTable(
      owner.accessToken,
      restaurantId,
      branchId,
      floorPlan.floorPlanId,
    );

    // Same-status "transition" - no implicit transitions.
    const sameStatus = await request(app.getHttpServer())
      .post(`/api/v1/tables/${tableId}/status`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ status: 'Available' })
      .expect(400);
    expect(sameStatus.body.code).toBe('VALIDATION_ERROR');

    // Move to Occupied, then attempt a forbidden direct swap to Cleaning.
    await request(app.getHttpServer())
      .post(`/api/v1/tables/${tableId}/status`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ status: 'Occupied' })
      .expect(200);

    const forbidden = await request(app.getHttpServer())
      .post(`/api/v1/tables/${tableId}/status`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ status: 'Cleaning' })
      .expect(400);
    expect(forbidden.body.code).toBe('VALIDATION_ERROR');

    // Table remained Occupied, untouched by the rejected attempt.
    const row = await prisma.table.findUnique({ where: { id: tableId } });
    expect(row?.status).toBe('Occupied');
  });

  it('POST /tables/:tableId/status rejects Reserved (not part of this enum) with a request validation error', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('t-status-reserved');
    const restaurantId = await createRestaurant(owner.accessToken);
    const branchId = await createBranch(owner.accessToken, restaurantId);
    const floorPlan = await createFloorPlan(owner.accessToken, restaurantId, branchId);
    const tableId = await createTable(
      owner.accessToken,
      restaurantId,
      branchId,
      floorPlan.floorPlanId,
    );

    await request(app.getHttpServer())
      .post(`/api/v1/tables/${tableId}/status`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ status: 'Reserved' })
      .expect(400);
  });

  it('PATCH /tables/:tableId never changes status - an unrecognized status field is rejected outright, and a legitimate PATCH leaves status untouched', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('t-status-patch-guard');
    const restaurantId = await createRestaurant(owner.accessToken);
    const branchId = await createBranch(owner.accessToken, restaurantId);
    const floorPlan = await createFloorPlan(owner.accessToken, restaurantId, branchId);
    const tableId = await createTable(
      owner.accessToken,
      restaurantId,
      branchId,
      floorPlan.floorPlanId,
    );

    // UpdateTableRequestDto has no `status` property - the global
    // whitelist/forbidNonWhitelisted ValidationPipe rejects the extraneous
    // field outright, rather than silently ignoring it.
    const smuggled = await request(app.getHttpServer())
      .patch(`/api/v1/tables/${tableId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ tableNumber: 'T1', capacity: 4, status: 'Disabled' })
      .expect(400);
    expect(smuggled.body.code).toBe('VALIDATION_ERROR');

    // A legitimate PATCH (no status field) still leaves status untouched.
    const response = await request(app.getHttpServer())
      .patch(`/api/v1/tables/${tableId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ tableNumber: 'T1', capacity: 4 })
      .expect(200);

    expect(response.body.data.status).toBe('Available');
  });

  it('POST /tables/:tableId/status from another organization returns 404 (cross-org IDOR)', async () => {
    if (!dbAvailable || !app) return;

    const ownerA = await registerAndLoginOwner('t-status-iso-a');
    const ownerB = await registerAndLoginOwner('t-status-iso-b');
    const restaurantId = await createRestaurant(ownerA.accessToken);
    const branchId = await createBranch(ownerA.accessToken, restaurantId);
    const floorPlan = await createFloorPlan(ownerA.accessToken, restaurantId, branchId);
    const tableId = await createTable(
      ownerA.accessToken,
      restaurantId,
      branchId,
      floorPlan.floorPlanId,
    );

    await request(app.getHttpServer())
      .post(`/api/v1/tables/${tableId}/status`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({ status: 'Occupied' })
      .expect(404);

    const row = await prisma.table.findUnique({ where: { id: tableId } });
    expect(row?.status).toBe('Available');
  });

  it('DELETE /tables/:tableId soft-deletes and is not idempotent', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('t-delete');
    const restaurantId = await createRestaurant(owner.accessToken);
    const branchId = await createBranch(owner.accessToken, restaurantId);
    const floorPlan = await createFloorPlan(owner.accessToken, restaurantId, branchId);
    const tableId = await createTable(
      owner.accessToken,
      restaurantId,
      branchId,
      floorPlan.floorPlanId,
    );

    await request(app.getHttpServer())
      .delete(`/api/v1/tables/${tableId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(204);

    const row = await prisma.table.findUnique({ where: { id: tableId } });
    expect(row?.deletedAt).not.toBeNull();

    await request(app.getHttpServer())
      .get(`/api/v1/tables/${tableId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/api/v1/tables/${tableId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(404);
  });

  // ---------------------------------------------------------------------
  // Tenant isolation / IDOR
  // ---------------------------------------------------------------------

  it("two different organizations never see each other's floor plans/tables - cross-org 404s", async () => {
    if (!dbAvailable || !app) return;

    const ownerA = await registerAndLoginOwner('iso-a');
    const ownerB = await registerAndLoginOwner('iso-b');
    const restaurantId = await createRestaurant(ownerA.accessToken);
    const branchId = await createBranch(ownerA.accessToken, restaurantId);
    const floorPlan = await createFloorPlan(ownerA.accessToken, restaurantId, branchId);
    const tableId = await createTable(
      ownerA.accessToken,
      restaurantId,
      branchId,
      floorPlan.floorPlanId,
    );

    await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/branches/${branchId}/floor-plans`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/branches/${branchId}/tables`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .expect(404);

    // Flat route: cross-org IDOR walks Table -> Branch -> Restaurant, and the
    // last hop (RestaurantRepository, tenant-scoped) is what makes this 404.
    await request(app.getHttpServer())
      .get(`/api/v1/tables/${tableId}`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/tables/${tableId}`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({ tableNumber: 'T1', capacity: 4 })
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/api/v1/tables/${tableId}`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .expect(404);

    const stillActive = await prisma.table.findUnique({ where: { id: tableId } });
    expect(stillActive?.deletedAt).toBeNull();
  });

  it('floor-plans/tables across restaurants (same org) both return 404 - IDOR protection', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('idor-restaurant');
    const restaurantA = await createRestaurant(owner.accessToken);
    const restaurantB = await createRestaurant(owner.accessToken);
    const branchId = await createBranch(owner.accessToken, restaurantA);
    const floorPlan = await createFloorPlan(owner.accessToken, restaurantA, branchId);

    await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantB}/branches/${branchId}/floor-plans`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantB}/branches/${branchId}/tables`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ floorPlanId: floorPlan.floorPlanId, tableNumber: 'T1', capacity: 4 })
      .expect(404);
  });

  it('floor-plans/tables across branches (same restaurant) both return 404 - IDOR protection', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('idor-branch');
    const restaurantId = await createRestaurant(owner.accessToken);
    const branchA = await createBranch(owner.accessToken, restaurantId);
    const branchB = await createBranch(owner.accessToken, restaurantId);
    const floorPlan = await createFloorPlan(owner.accessToken, restaurantId, branchA);
    const tableId = await createTable(
      owner.accessToken,
      restaurantId,
      branchA,
      floorPlan.floorPlanId,
    );

    // Table created under branchA must not be visible/listable under branchB.
    await request(app.getHttpServer())
      .get(
        `/api/v1/restaurants/${restaurantId}/branches/${branchB}/floor-plans/${floorPlan.floorPlanId}/tables`,
      )
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(404);

    const listUnderB = await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/branches/${branchB}/tables`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(listUnderB.body.data.total).toBe(0);

    // Sanity: the table is still reachable through its real branch/flat route.
    await request(app.getHttpServer())
      .get(`/api/v1/tables/${tableId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
  });

  // ---------------------------------------------------------------------
  // Branch cascade: DeleteBranchUseCase soft-deletes FloorPlans and Tables
  // ---------------------------------------------------------------------

  it('DELETE branch cascades to soft-delete its FloorPlans and Tables (TASKS.md Phase 6.1 decisions #3/#6)', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('cascade');
    const restaurantId = await createRestaurant(owner.accessToken);
    const branchId = await createBranch(owner.accessToken, restaurantId);
    const floorPlan = await createFloorPlan(owner.accessToken, restaurantId, branchId);
    const tableId = await createTable(
      owner.accessToken,
      restaurantId,
      branchId,
      floorPlan.floorPlanId,
    );

    await request(app.getHttpServer())
      .delete(`/api/v1/restaurants/${restaurantId}/branches/${branchId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(204);

    const branchRow = await prisma.branch.findUnique({ where: { id: branchId } });
    expect(branchRow?.deletedAt).not.toBeNull();

    const floorPlanRow = await prisma.floorPlan.findUnique({
      where: { id: floorPlan.floorPlanId },
    });
    expect(floorPlanRow?.deletedAt).not.toBeNull();

    const tableRow = await prisma.table.findUnique({ where: { id: tableId } });
    expect(tableRow?.deletedAt).not.toBeNull();

    // Every soft-delete happened inside the same transaction (TASKS.md Phase
    // 6.1 decision #6) - no partial-completion state is reachable, so all
    // three deletedAt timestamps must be identical.
    expect(floorPlanRow?.deletedAt?.getTime()).toBe(branchRow?.deletedAt?.getTime());
    expect(tableRow?.deletedAt?.getTime()).toBe(branchRow?.deletedAt?.getTime());
  });
});
