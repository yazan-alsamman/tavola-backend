import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, RoleScope } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword, seedOwnerAndOrganization } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'menus-e2e-';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

/**
 * Phase 18 (Menu Management, ADR-031/ADR-032, implemented 2026-08-03) e2e
 * coverage: Owner/Admin management CRUD across the full Menu -> Category ->
 * Item -> OptionGroup/Option/AddOn hierarchy, Set-Default atomicity,
 * Employee menu:manage authorization (positive and negative), IDOR/cross-org
 * isolation, bulk reorder, and the Customer/public read surface - against a
 * real Postgres-backed running application.
 */
describe('/api/v1/restaurants/:restaurantId/menus (e2e, Phase 18)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let managerRoleId: string;
  let receptionistRoleId: string;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — menus e2e tests NOT EXECUTED.');
      return;
    }
    passwordHash = await hashTestPassword(PASSWORD);
    app = await createTestApp();

    // Real seeded slugs (prisma/seed.ts) - `manager` carries `menu:manage`
    // via a RolePermission row; `receptionist` does not, used as the
    // "missing permission" negative case below.
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
    try {
      if (dbAvailable) {
        const testRestaurants = await prisma.restaurant.findMany({
          where: { slug: { startsWith: TEST_PREFIX } },
          select: { id: true },
        });
        const restaurantIds = testRestaurants.map((r) => r.id);
        await prisma.menuItemOption.deleteMany({ where: { restaurantId: { in: restaurantIds } } });
        await prisma.menuItemOptionGroup.deleteMany({
          where: { restaurantId: { in: restaurantIds } },
        });
        await prisma.menuItemAddOn.deleteMany({ where: { restaurantId: { in: restaurantIds } } });
        await prisma.menuItemAvailability.deleteMany({
          where: { restaurantId: { in: restaurantIds } },
        });
        await prisma.menuItem.deleteMany({ where: { restaurantId: { in: restaurantIds } } });
        await prisma.menuCategory.deleteMany({ where: { restaurantId: { in: restaurantIds } } });
        await prisma.menu.deleteMany({ where: { restaurantId: { in: restaurantIds } } });
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
      .send({ name: 'Menus Bistro', slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    return restaurantResponse.body.data.restaurantId as string;
  }

  async function inviteAndLoginEmployee(
    ownerAccessToken: string,
    restaurantId: string,
    roleId: string,
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
      .send({ roleId, firstName: 'Emma', lastName: 'Ployee', email: employeeEmail })
      .expect(201);

    const loginResponse = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: employeeEmail, password: PASSWORD, deviceType: 'web' })
      .expect(200);
    return { accessToken: loginResponse.body.data.accessToken as string };
  }

  it('Owner: creates two Menus, the first auto-defaults, set-default atomically swaps', async () => {
    if (!dbAvailable) return;
    const owner = await registerAndLoginOwner('default-swap');
    const restaurantId = await setUpRestaurant(owner.accessToken);

    const first = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/menus`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Breakfast' })
      .expect(201);
    expect(first.body.data.isDefault).toBe(true);

    const second = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/menus`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Dinner' })
      .expect(201);
    expect(second.body.data.isDefault).toBe(false);

    await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/menus/${second.body.data.id}/set-default`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    const listResponse = await request(app!.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/menus`)
      .expect(200);
    const firstAfter = listResponse.body.data.find(
      (m: { id: string }) => m.id === first.body.data.id,
    );
    const secondAfter = listResponse.body.data.find(
      (m: { id: string }) => m.id === second.body.data.id,
    );
    expect(firstAfter.isDefault).toBe(false);
    expect(secondAfter.isDefault).toBe(true);
  });

  it('Owner: builds the full nested hierarchy and the Customer sees it via the public tree read', async () => {
    if (!dbAvailable) return;
    const owner = await registerAndLoginOwner('full-tree');
    const restaurantId = await setUpRestaurant(owner.accessToken);
    const auth = { Authorization: `Bearer ${owner.accessToken}` };

    const menu = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/menus`)
      .set(auth)
      .send({ name: 'Main Menu' })
      .expect(201);
    const menuId = menu.body.data.id as string;

    const category = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories`)
      .set(auth)
      .send({ name: 'Pizzas', description: 'Wood-fired.' })
      .expect(201);
    const categoryId = category.body.data.id as string;

    const item = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items`)
      .set(auth)
      .send({ name: 'Margherita', price: 12.5, currency: 'USD' })
      .expect(201);
    const itemId = item.body.data.id as string;

    await request(app!.getHttpServer())
      .post(
        `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${itemId}/feature`,
      )
      .set(auth)
      .expect(200);

    const optionGroup = await request(app!.getHttpServer())
      .post(
        `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${itemId}/option-groups`,
      )
      .set(auth)
      .send({ name: 'Size', required: true, minSelections: 1, maxSelections: 1 })
      .expect(201);
    const optionGroupId = optionGroup.body.data.id as string;

    await request(app!.getHttpServer())
      .post(
        `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${itemId}/option-groups/${optionGroupId}/options`,
      )
      .set(auth)
      .send({ name: 'Large', priceModifier: 3 })
      .expect(201);

    await request(app!.getHttpServer())
      .post(
        `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${itemId}/add-ons`,
      )
      .set(auth)
      .send({ name: 'Extra Cheese', price: 1.5 })
      .expect(201);

    // Update Item to Scheduled availability, then set windows.
    await request(app!.getHttpServer())
      .patch(
        `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${itemId}`,
      )
      .set(auth)
      .send({ name: 'Margherita', price: 12.5, currency: 'USD', availabilityMode: 'Scheduled' })
      .expect(200);
    await request(app!.getHttpServer())
      .patch(
        `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${itemId}/availability`,
      )
      .set(auth)
      .send({ windows: [{ dayOfWeek: 1, startTime: '08:00', endTime: '11:00' }] })
      .expect(204);

    // Customer public read - no Authorization header at all.
    const publicTree = await request(app!.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/menus/${menuId}`)
      .expect(200);

    expect(publicTree.body.data.categories).toHaveLength(1);
    const publicCategory = publicTree.body.data.categories[0];
    expect(publicCategory.items).toHaveLength(1);
    const publicItem = publicCategory.items[0];
    expect(publicItem.isFeatured).toBe(true);
    expect(publicItem.availabilityMode).toBe('Scheduled');
    expect(publicItem.optionGroups).toHaveLength(1);
    expect(publicItem.optionGroups[0].options).toHaveLength(1);
    expect(publicItem.addOns).toHaveLength(1);
    expect(publicItem.availability).toEqual([
      { dayOfWeek: 1, startTime: '08:00', endTime: '11:00' },
    ]);

    // Default-tree read (no menuId in the path) resolves to the same Menu.
    const defaultTree = await request(app!.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/menus/default`)
      .expect(200);
    expect(defaultTree.body.data.id).toBe(menuId);
  });

  it('Employee holding menu:manage creates a Category; an Employee without it (Receptionist) is forbidden', async () => {
    if (!dbAvailable) return;
    const owner = await registerAndLoginOwner('employee-authz');
    const restaurantId = await setUpRestaurant(owner.accessToken);
    const menu = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/menus`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Main' })
      .expect(201);

    const manager = await inviteAndLoginEmployee(owner.accessToken, restaurantId, managerRoleId);
    const managerCategory = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/menus/${menu.body.data.id}/categories`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send({ name: 'Manager Category' })
      .expect(201);
    expect(managerCategory.body.data.name).toBe('Manager Category');

    const receptionist = await inviteAndLoginEmployee(
      owner.accessToken,
      restaurantId,
      receptionistRoleId,
    );
    await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/menus/${menu.body.data.id}/categories`)
      .set('Authorization', `Bearer ${receptionist.accessToken}`)
      .send({ name: 'Receptionist Category' })
      .expect(403);
  });

  it('cross-organization management access is denied (IDOR-safe 404)', async () => {
    if (!dbAvailable) return;
    const ownerA = await registerAndLoginOwner('cross-a');
    const ownerB = await registerAndLoginOwner('cross-b');
    const restaurantAId = await setUpRestaurant(ownerA.accessToken);

    const menu = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantAId}/menus`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ name: 'Main' })
      .expect(201);

    await request(app!.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantAId}/menus/${menu.body.data.id}`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({ name: 'Hijacked', displayOrder: 0 })
      .expect(404);

    await request(app!.getHttpServer())
      .delete(`/api/v1/restaurants/${restaurantAId}/menus/${menu.body.data.id}`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .expect(404);
  });

  it('Reorder Categories: whole-set replacement succeeds; a partial set is rejected (400)', async () => {
    if (!dbAvailable) return;
    const owner = await registerAndLoginOwner('reorder');
    const restaurantId = await setUpRestaurant(owner.accessToken);
    const auth = { Authorization: `Bearer ${owner.accessToken}` };
    const menu = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/menus`)
      .set(auth)
      .send({ name: 'Main' })
      .expect(201);
    const menuId = menu.body.data.id as string;

    const categoryIds: string[] = [];
    for (const name of ['A', 'B', 'C']) {
      const category = await request(app!.getHttpServer())
        .post(`/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories`)
        .set(auth)
        .send({ name })
        .expect(201);
      categoryIds.push(category.body.data.id);
    }

    const reversed = [...categoryIds].reverse();
    const reorderResponse = await request(app!.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/reorder`)
      .set(auth)
      .send({ orderedIds: reversed })
      .expect(200);
    expect(reorderResponse.body.data.map((c: { id: string }) => c.id)).toEqual(reversed);

    await request(app!.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/reorder`)
      .set(auth)
      .send({ orderedIds: [categoryIds[0]] })
      .expect(400);
  });

  it('unauthenticated request to a management route is rejected (401); public read needs no token', async () => {
    if (!dbAvailable) return;
    const owner = await registerAndLoginOwner('unauth');
    const restaurantId = await setUpRestaurant(owner.accessToken);

    await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/menus`)
      .send({ name: 'Main' })
      .expect(401);

    await request(app!.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/menus`)
      .expect(200);
  });
});
