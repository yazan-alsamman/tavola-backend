import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword, seedOwnerAndOrganization } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

/**
 * ADR-040 - concurrent dining areas (halls) inside one FloorPlan, over real
 * HTTP. Kept in its own file rather than appended to `tables.e2e-spec.ts`,
 * which is already 800+ lines covering a different feature set.
 */
const prisma = new PrismaClient();
const TEST_PREFIX = 'area-e2e-';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

describe('Floor Plan Areas (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — floor plan area e2e tests NOT EXECUTED.');
      return;
    }
    passwordHash = await hashTestPassword(PASSWORD);
    app = await createTestApp();
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.table.deleteMany({
        where: { branch: { restaurant: { slug: { startsWith: TEST_PREFIX } } } },
      });
      await prisma.floorPlanArea.deleteMany({
        where: { floorPlan: { branch: { restaurant: { slug: { startsWith: TEST_PREFIX } } } } },
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

  async function registerAndLoginOwner(suffix: string): Promise<string> {
    const email = `${TEST_PREFIX}${suffix}-${uniqueId()}@example.com`;
    await seedOwnerAndOrganization(prisma, {
      email,
      passwordHash,
      lastName: suffix,
      organizationName: `${TEST_PREFIX}Org ${suffix} ${uniqueId()}`,
    });

    const loginResponse = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, deviceType: 'web' })
      .expect(200);

    return loginResponse.body.data.accessToken as string;
  }

  interface Scope {
    accessToken: string;
    restaurantId: string;
    branchId: string;
    floorPlanId: string;
    otherFloorPlanId: string;
  }

  async function createScope(suffix: string): Promise<Scope> {
    const accessToken = await registerAndLoginOwner(suffix);
    const server = app!.getHttpServer();

    const restaurant = await request(server)
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'The Old Mill', slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    const restaurantId = restaurant.body.data.restaurantId as string;

    const branch = await request(server)
      .post(`/api/v1/restaurants/${restaurantId}/branches`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        city: 'Damascus',
        address: '123 Main St',
        countryCode: 'SY',
        timezone: 'Asia/Damascus',
      })
      .expect(201);
    const branchId = branch.body.data.branchId as string;

    const plans: string[] = [];
    for (const name of ['Main Floor', 'Patio']) {
      const plan = await request(server)
        .post(`/api/v1/restaurants/${restaurantId}/branches/${branchId}/floor-plans`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name })
        .expect(201);
      plans.push(plan.body.data.floorPlanId as string);
    }

    return {
      accessToken,
      restaurantId,
      branchId,
      floorPlanId: plans[0],
      otherFloorPlanId: plans[1],
    };
  }

  function areasUrl(scope: Scope, floorPlanId = scope.floorPlanId): string {
    return `/api/v1/restaurants/${scope.restaurantId}/branches/${scope.branchId}/floor-plans/${floorPlanId}/areas`;
  }

  async function createArea(
    scope: Scope,
    body: { name: string; color: string; sortOrder?: number },
    floorPlanId = scope.floorPlanId,
  ): Promise<string> {
    const response = await request(app!.getHttpServer())
      .post(areasUrl(scope, floorPlanId))
      .set('Authorization', `Bearer ${scope.accessToken}`)
      .send(body)
      .expect(201);
    return response.body.data.floorPlanAreaId as string;
  }

  // -------------------------------------------------------------------------

  it('creates two concurrent areas in one floor plan and lists both in tab order', async () => {
    if (!dbAvailable) return;
    const scope = await createScope('concurrent');

    await createArea(scope, { name: 'للضيوف', color: '#F97316', sortOrder: 1 });
    await createArea(scope, { name: 'Main Hall', color: '#14b8a6', sortOrder: 0 });

    const response = await request(app!.getHttpServer())
      .get(areasUrl(scope))
      .set('Authorization', `Bearer ${scope.accessToken}`)
      .expect(200);

    expect(response.body.data.items).toHaveLength(2);
    expect(response.body.data.items.map((item: { name: string }) => item.name)).toEqual([
      'Main Hall',
      'للضيوف',
    ]);
    expect(response.body.data.items[0].color).toBe('#14B8A6');
  });

  it('leaves the branch floor-plan activation state untouched when areas are created', async () => {
    if (!dbAvailable) return;
    const scope = await createScope('activation');
    await createArea(scope, { name: 'Main Hall', color: '#14B8A6' });

    const plans = await request(app!.getHttpServer())
      .get(`/api/v1/restaurants/${scope.restaurantId}/branches/${scope.branchId}/floor-plans`)
      .set('Authorization', `Bearer ${scope.accessToken}`)
      .expect(200);

    const active = plans.body.data.items.filter((plan: { isActive: boolean }) => plan.isActive);
    expect(active).toHaveLength(1);
    expect(active[0].floorPlanId).toBe(scope.floorPlanId);
  });

  it('rejects a duplicate area name within one floor plan, but allows it in another', async () => {
    if (!dbAvailable) return;
    const scope = await createScope('dupes');
    await createArea(scope, { name: 'Main Hall', color: '#14B8A6' });

    await request(app!.getHttpServer())
      .post(areasUrl(scope))
      .set('Authorization', `Bearer ${scope.accessToken}`)
      .send({ name: 'Main Hall', color: '#14B8A6' })
      .expect(409);

    await request(app!.getHttpServer())
      .post(areasUrl(scope, scope.otherFloorPlanId))
      .set('Authorization', `Bearer ${scope.accessToken}`)
      .send({ name: 'Main Hall', color: '#14B8A6' })
      .expect(201);
  });

  it('rejects a malformed color with 400', async () => {
    if (!dbAvailable) return;
    const scope = await createScope('color');

    await request(app!.getHttpServer())
      .post(areasUrl(scope))
      .set('Authorization', `Bearer ${scope.accessToken}`)
      .send({ name: 'Main Hall', color: '#FFF' })
      .expect(400);
  });

  it('requires authentication', async () => {
    if (!dbAvailable) return;
    const scope = await createScope('auth');

    await request(app!.getHttpServer()).get(areasUrl(scope)).expect(401);
  });

  it('does not leak an area of another floor plan through the get route', async () => {
    if (!dbAvailable) return;
    const scope = await createScope('isolation');
    const areaId = await createArea(scope, { name: 'Main Hall', color: '#14B8A6' });

    await request(app!.getHttpServer())
      .get(`${areasUrl(scope, scope.otherFloorPlanId)}/${areaId}`)
      .set('Authorization', `Bearer ${scope.accessToken}`)
      .expect(404);
  });

  it('full-replaces an area through PATCH', async () => {
    if (!dbAvailable) return;
    const scope = await createScope('patch');
    const areaId = await createArea(scope, { name: 'Main Hall', color: '#14B8A6', sortOrder: 0 });

    const response = await request(app!.getHttpServer())
      .patch(`${areasUrl(scope)}/${areaId}`)
      .set('Authorization', `Bearer ${scope.accessToken}`)
      .send({ name: 'Guests', color: '#f97316', sortOrder: 3 })
      .expect(200);

    expect(response.body.data).toMatchObject({
      floorPlanAreaId: areaId,
      name: 'Guests',
      color: '#F97316',
      sortOrder: 3,
    });
  });

  it('places a table in an area, persists drag-save layout fields, and exposes both', async () => {
    if (!dbAvailable) return;
    const scope = await createScope('table');
    const areaId = await createArea(scope, { name: 'Main Hall', color: '#14B8A6' });
    const server = app!.getHttpServer();

    const created = await request(server)
      .post(`/api/v1/restaurants/${scope.restaurantId}/branches/${scope.branchId}/tables`)
      .set('Authorization', `Bearer ${scope.accessToken}`)
      .send({
        floorPlanId: scope.floorPlanId,
        floorPlanAreaId: areaId,
        tableNumber: `T-${uniqueId()}`,
        capacity: 4,
        color: '#f97316',
      })
      .expect(201);
    const tableId = created.body.data.tableId as string;
    expect(created.body.data.floorPlanAreaId).toBe(areaId);
    expect(created.body.data.color).toBe('#F97316');

    const updated = await request(server)
      .patch(`/api/v1/tables/${tableId}`)
      .set('Authorization', `Bearer ${scope.accessToken}`)
      .send({
        tableNumber: created.body.data.tableNumber,
        capacity: 6,
        floorPlanAreaId: areaId,
        positionX: 120.5,
        positionY: 240.25,
        width: 80,
        height: 40,
        rotation: 45,
        shape: 'Rectangle',
        color: null,
      })
      .expect(200);

    expect(updated.body.data).toMatchObject({
      floorPlanAreaId: areaId,
      positionX: 120.5,
      positionY: 240.25,
      width: 80,
      height: 40,
      rotation: 45,
      color: null,
    });
  });

  it('rejects assigning a table to an area of another floor plan', async () => {
    if (!dbAvailable) return;
    const scope = await createScope('cross-plan');
    const foreignAreaId = await createArea(
      scope,
      { name: 'Terrace', color: '#14B8A6' },
      scope.otherFloorPlanId,
    );

    await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${scope.restaurantId}/branches/${scope.branchId}/tables`)
      .set('Authorization', `Bearer ${scope.accessToken}`)
      .send({
        floorPlanId: scope.floorPlanId,
        floorPlanAreaId: foreignAreaId,
        tableNumber: `T-${uniqueId()}`,
        capacity: 4,
      })
      .expect(404);
  });

  it('filters the floor-plan table list by area', async () => {
    if (!dbAvailable) return;
    const scope = await createScope('filter');
    const areaId = await createArea(scope, { name: 'Main Hall', color: '#14B8A6' });
    const server = app!.getHttpServer();

    await request(server)
      .post(`/api/v1/restaurants/${scope.restaurantId}/branches/${scope.branchId}/tables`)
      .set('Authorization', `Bearer ${scope.accessToken}`)
      .send({
        floorPlanId: scope.floorPlanId,
        floorPlanAreaId: areaId,
        tableNumber: `T-in-${uniqueId()}`,
        capacity: 4,
      })
      .expect(201);
    await request(server)
      .post(`/api/v1/restaurants/${scope.restaurantId}/branches/${scope.branchId}/tables`)
      .set('Authorization', `Bearer ${scope.accessToken}`)
      .send({
        floorPlanId: scope.floorPlanId,
        tableNumber: `T-out-${uniqueId()}`,
        capacity: 4,
      })
      .expect(201);

    const tablesUrl = `/api/v1/restaurants/${scope.restaurantId}/branches/${scope.branchId}/floor-plans/${scope.floorPlanId}/tables`;

    const all = await request(server)
      .get(tablesUrl)
      .set('Authorization', `Bearer ${scope.accessToken}`)
      .expect(200);
    expect(all.body.data.total).toBe(2);

    const filtered = await request(server)
      .get(`${tablesUrl}?floorPlanAreaId=${areaId}`)
      .set('Authorization', `Bearer ${scope.accessToken}`)
      .expect(200);
    expect(filtered.body.data.total).toBe(1);

    // A blank filter means "no filter", exactly like every other optional
    // query parameter in this API (Phase 19.10 Defect 4).
    const blank = await request(server)
      .get(`${tablesUrl}?floorPlanAreaId=`)
      .set('Authorization', `Bearer ${scope.accessToken}`)
      .expect(200);
    expect(blank.body.data.total).toBe(2);
  });

  it('reconciles area membership on move: the target area is required to belong to the target plan', async () => {
    if (!dbAvailable) return;
    const scope = await createScope('move');
    const sourceAreaId = await createArea(scope, { name: 'Main Hall', color: '#14B8A6' });
    const targetAreaId = await createArea(
      scope,
      { name: 'Terrace', color: '#F97316' },
      scope.otherFloorPlanId,
    );
    const server = app!.getHttpServer();

    const created = await request(server)
      .post(`/api/v1/restaurants/${scope.restaurantId}/branches/${scope.branchId}/tables`)
      .set('Authorization', `Bearer ${scope.accessToken}`)
      .send({
        floorPlanId: scope.floorPlanId,
        floorPlanAreaId: sourceAreaId,
        tableNumber: `T-${uniqueId()}`,
        capacity: 4,
      })
      .expect(201);
    const tableId = created.body.data.tableId as string;

    // The source plan's area is not a valid target area.
    await request(server)
      .post(`/api/v1/tables/${tableId}/move`)
      .set('Authorization', `Bearer ${scope.accessToken}`)
      .send({ targetFloorPlanId: scope.otherFloorPlanId, targetFloorPlanAreaId: sourceAreaId })
      .expect(404);

    const moved = await request(server)
      .post(`/api/v1/tables/${tableId}/move`)
      .set('Authorization', `Bearer ${scope.accessToken}`)
      .send({ targetFloorPlanId: scope.otherFloorPlanId, targetFloorPlanAreaId: targetAreaId })
      .expect(200);

    expect(moved.body.data.floorPlanId).toBe(scope.otherFloorPlanId);
    expect(moved.body.data.floorPlanAreaId).toBe(targetAreaId);
  });

  it('clears area membership when a move supplies no target area', async () => {
    if (!dbAvailable) return;
    const scope = await createScope('move-clear');
    const areaId = await createArea(scope, { name: 'Main Hall', color: '#14B8A6' });
    const server = app!.getHttpServer();

    const created = await request(server)
      .post(`/api/v1/restaurants/${scope.restaurantId}/branches/${scope.branchId}/tables`)
      .set('Authorization', `Bearer ${scope.accessToken}`)
      .send({
        floorPlanId: scope.floorPlanId,
        floorPlanAreaId: areaId,
        tableNumber: `T-${uniqueId()}`,
        capacity: 4,
      })
      .expect(201);

    const moved = await request(server)
      .post(`/api/v1/tables/${created.body.data.tableId}/move`)
      .set('Authorization', `Bearer ${scope.accessToken}`)
      .send({ targetFloorPlanId: scope.otherFloorPlanId })
      .expect(200);

    expect(moved.body.data.floorPlanAreaId).toBeNull();
  });

  it('refuses to delete an area that still holds a table, and succeeds once it is empty', async () => {
    if (!dbAvailable) return;
    const scope = await createScope('delete');
    const areaId = await createArea(scope, { name: 'Main Hall', color: '#14B8A6' });
    const server = app!.getHttpServer();

    const created = await request(server)
      .post(`/api/v1/restaurants/${scope.restaurantId}/branches/${scope.branchId}/tables`)
      .set('Authorization', `Bearer ${scope.accessToken}`)
      .send({
        floorPlanId: scope.floorPlanId,
        floorPlanAreaId: areaId,
        tableNumber: `T-${uniqueId()}`,
        capacity: 4,
      })
      .expect(201);

    await request(server)
      .delete(`${areasUrl(scope)}/${areaId}`)
      .set('Authorization', `Bearer ${scope.accessToken}`)
      .expect(409);

    await request(server)
      .delete(`/api/v1/tables/${created.body.data.tableId}`)
      .set('Authorization', `Bearer ${scope.accessToken}`)
      .expect(204);

    await request(server)
      .delete(`${areasUrl(scope)}/${areaId}`)
      .set('Authorization', `Bearer ${scope.accessToken}`)
      .expect(204);

    await request(server)
      .get(`${areasUrl(scope)}/${areaId}`)
      .set('Authorization', `Bearer ${scope.accessToken}`)
      .expect(404);
  });

  it('exposes areas and table colors on the public discovery floor plan', async () => {
    if (!dbAvailable) return;
    const scope = await createScope('discovery');
    const areaId = await createArea(scope, { name: 'Main Hall', color: '#14B8A6', sortOrder: 0 });
    const server = app!.getHttpServer();

    await request(server)
      .post(`/api/v1/restaurants/${scope.restaurantId}/branches/${scope.branchId}/tables`)
      .set('Authorization', `Bearer ${scope.accessToken}`)
      .send({
        floorPlanId: scope.floorPlanId,
        floorPlanAreaId: areaId,
        tableNumber: `T-${uniqueId()}`,
        capacity: 4,
        color: '#F97316',
      })
      .expect(201);

    const response = await request(server)
      .get(
        `/api/v1/discovery/restaurants/${scope.restaurantId}/branches/${scope.branchId}/floor-plan`,
      )
      .expect(200);

    expect(response.body.data.areas).toEqual([
      { floorPlanAreaId: areaId, name: 'Main Hall', color: '#14B8A6', sortOrder: 0 },
    ]);
    expect(response.body.data.tables[0]).toMatchObject({
      floorPlanAreaId: areaId,
      color: '#F97316',
    });
    // Customer-safe projection discipline is unchanged by ADR-040.
    expect(response.body.data.tables[0]).not.toHaveProperty('status');
    expect(response.body.data.tables[0]).not.toHaveProperty('mergeGroupId');
  });
});
