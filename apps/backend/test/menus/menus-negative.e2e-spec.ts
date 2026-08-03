import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword, seedOwnerAndOrganization } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'menus-neg-e2e-';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

/**
 * Phase 18 (Menu Management, ADR-031/ADR-032) - dedicated negative-path e2e
 * coverage: every parent/child ownership mismatch across the Menu ->
 * Category -> Item -> OptionGroup/Option/AddOn hierarchy, cross-restaurant
 * and cross-organization resource ids, and soft-deleted parents. Every case
 * collapses to 404 NOT_FOUND (IDOR-safe - never a distinguishing 403/400
 * that would let a caller probe for the existence of a resource they cannot
 * see), matching every other module's own "unknown/cross-tenant/wrong-parent
 * collapse to the same response" convention (`MenusController`'s own doc
 * comment, `assertActorCanManageMenu`).
 */
describe('/api/v1/restaurants/:restaurantId/menus - negative paths (e2e, Phase 18)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — menus negative e2e tests NOT EXECUTED.');
      return;
    }
    passwordHash = await hashTestPassword(PASSWORD);
    app = await createTestApp();
  });

  afterAll(async () => {
    try {
      if (dbAvailable) {
        const restaurants = await prisma.restaurant.findMany({
          where: { slug: { startsWith: TEST_PREFIX } },
          select: { id: true },
        });
        const restaurantIds = restaurants.map((r) => r.id);
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

  async function registerAndLoginOwner(suffix: string): Promise<{ accessToken: string }> {
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
    return { accessToken: loginResponse.body.data.accessToken as string };
  }

  async function setUpRestaurant(accessToken: string): Promise<string> {
    const response = await request(app!.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Negative Path Bistro', slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    return response.body.data.restaurantId as string;
  }

  async function createMenu(
    accessToken: string,
    restaurantId: string,
    name = 'Main',
  ): Promise<string> {
    const response = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/menus`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name })
      .expect(201);
    return response.body.data.id as string;
  }

  async function createCategory(
    accessToken: string,
    restaurantId: string,
    menuId: string,
    name = 'Category',
  ): Promise<string> {
    const response = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name })
      .expect(201);
    return response.body.data.id as string;
  }

  async function createItem(
    accessToken: string,
    restaurantId: string,
    menuId: string,
    categoryId: string,
    name = 'Item',
  ): Promise<string> {
    const response = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name, price: 10 })
      .expect(201);
    return response.body.data.id as string;
  }

  async function createOptionGroup(
    accessToken: string,
    restaurantId: string,
    menuId: string,
    categoryId: string,
    itemId: string,
  ): Promise<string> {
    const response = await request(app!.getHttpServer())
      .post(
        `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${itemId}/option-groups`,
      )
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Size', required: true, minSelections: 1, maxSelections: 1 })
      .expect(201);
    return response.body.data.id as string;
  }

  async function createOption(
    accessToken: string,
    restaurantId: string,
    menuId: string,
    categoryId: string,
    itemId: string,
    optionGroupId: string,
  ): Promise<string> {
    const response = await request(app!.getHttpServer())
      .post(
        `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${itemId}/option-groups/${optionGroupId}/options`,
      )
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Large', priceModifier: 2 })
      .expect(201);
    return response.body.data.id as string;
  }

  async function createAddOn(
    accessToken: string,
    restaurantId: string,
    menuId: string,
    categoryId: string,
    itemId: string,
  ): Promise<string> {
    const response = await request(app!.getHttpServer())
      .post(
        `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${itemId}/add-ons`,
      )
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Extra Cheese', price: 1.5 })
      .expect(201);
    return response.body.data.id as string;
  }

  describe('parent/child ownership mismatches (same restaurant, wrong ancestor in the URL)', () => {
    it('Category does not belong to the Menu in the URL', async () => {
      if (!dbAvailable) return;
      const owner = await registerAndLoginOwner('cat-wrong-menu');
      const auth = { Authorization: `Bearer ${owner.accessToken}` };
      const restaurantId = await setUpRestaurant(owner.accessToken);
      const menu1 = await createMenu(owner.accessToken, restaurantId, 'Menu 1');
      const menu2 = await createMenu(owner.accessToken, restaurantId, 'Menu 2');
      const category = await createCategory(owner.accessToken, restaurantId, menu1);

      await request(app!.getHttpServer())
        .patch(`/api/v1/restaurants/${restaurantId}/menus/${menu2}/categories/${category}`)
        .set(auth)
        .send({ name: 'Hijacked' })
        .expect(404);

      await request(app!.getHttpServer())
        .delete(`/api/v1/restaurants/${restaurantId}/menus/${menu2}/categories/${category}`)
        .set(auth)
        .expect(404);
    });

    it('Item does not belong to the Category in the URL', async () => {
      if (!dbAvailable) return;
      const owner = await registerAndLoginOwner('item-wrong-category');
      const auth = { Authorization: `Bearer ${owner.accessToken}` };
      const restaurantId = await setUpRestaurant(owner.accessToken);
      const menuId = await createMenu(owner.accessToken, restaurantId);
      const category1 = await createCategory(owner.accessToken, restaurantId, menuId, 'Category 1');
      const category2 = await createCategory(owner.accessToken, restaurantId, menuId, 'Category 2');
      const item = await createItem(owner.accessToken, restaurantId, menuId, category1);

      await request(app!.getHttpServer())
        .patch(
          `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${category2}/items/${item}`,
        )
        .set(auth)
        .send({ name: 'Hijacked', price: 1, availabilityMode: 'Always' })
        .expect(404);

      await request(app!.getHttpServer())
        .delete(
          `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${category2}/items/${item}`,
        )
        .set(auth)
        .expect(404);
    });

    it('OptionGroup does not belong to the MenuItem in the URL', async () => {
      if (!dbAvailable) return;
      const owner = await registerAndLoginOwner('group-wrong-item');
      const auth = { Authorization: `Bearer ${owner.accessToken}` };
      const restaurantId = await setUpRestaurant(owner.accessToken);
      const menuId = await createMenu(owner.accessToken, restaurantId);
      const categoryId = await createCategory(owner.accessToken, restaurantId, menuId);
      const item1 = await createItem(owner.accessToken, restaurantId, menuId, categoryId, 'Item 1');
      const item2 = await createItem(owner.accessToken, restaurantId, menuId, categoryId, 'Item 2');
      const group = await createOptionGroup(
        owner.accessToken,
        restaurantId,
        menuId,
        categoryId,
        item1,
      );

      await request(app!.getHttpServer())
        .patch(
          `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${item2}/option-groups/${group}`,
        )
        .set(auth)
        .send({ name: 'Hijacked', required: false, minSelections: 0, maxSelections: 1 })
        .expect(404);

      await request(app!.getHttpServer())
        .delete(
          `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${item2}/option-groups/${group}`,
        )
        .set(auth)
        .expect(404);
    });

    it('Option does not belong to the OptionGroup in the URL', async () => {
      if (!dbAvailable) return;
      const owner = await registerAndLoginOwner('option-wrong-group');
      const auth = { Authorization: `Bearer ${owner.accessToken}` };
      const restaurantId = await setUpRestaurant(owner.accessToken);
      const menuId = await createMenu(owner.accessToken, restaurantId);
      const categoryId = await createCategory(owner.accessToken, restaurantId, menuId);
      const itemId = await createItem(owner.accessToken, restaurantId, menuId, categoryId);
      const group1 = await createOptionGroup(
        owner.accessToken,
        restaurantId,
        menuId,
        categoryId,
        itemId,
      );
      const group2 = await createOptionGroup(
        owner.accessToken,
        restaurantId,
        menuId,
        categoryId,
        itemId,
      );
      const option = await createOption(
        owner.accessToken,
        restaurantId,
        menuId,
        categoryId,
        itemId,
        group1,
      );

      await request(app!.getHttpServer())
        .patch(
          `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${itemId}/option-groups/${group2}/options/${option}`,
        )
        .set(auth)
        .send({ name: 'Hijacked', priceModifier: 0, active: true })
        .expect(404);

      await request(app!.getHttpServer())
        .delete(
          `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${itemId}/option-groups/${group2}/options/${option}`,
        )
        .set(auth)
        .expect(404);
    });

    it('AddOn does not belong to the MenuItem in the URL', async () => {
      if (!dbAvailable) return;
      const owner = await registerAndLoginOwner('addon-wrong-item');
      const auth = { Authorization: `Bearer ${owner.accessToken}` };
      const restaurantId = await setUpRestaurant(owner.accessToken);
      const menuId = await createMenu(owner.accessToken, restaurantId);
      const categoryId = await createCategory(owner.accessToken, restaurantId, menuId);
      const item1 = await createItem(owner.accessToken, restaurantId, menuId, categoryId, 'Item 1');
      const item2 = await createItem(owner.accessToken, restaurantId, menuId, categoryId, 'Item 2');
      const addOn = await createAddOn(owner.accessToken, restaurantId, menuId, categoryId, item1);

      await request(app!.getHttpServer())
        .patch(
          `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${item2}/add-ons/${addOn}`,
        )
        .set(auth)
        .send({ name: 'Hijacked', price: 1, active: true })
        .expect(404);

      await request(app!.getHttpServer())
        .delete(
          `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${item2}/add-ons/${addOn}`,
        )
        .set(auth)
        .expect(404);
    });

    it('Availability replace rejects when the Item does not belong to the Category in the URL', async () => {
      if (!dbAvailable) return;
      const owner = await registerAndLoginOwner('avail-wrong-category');
      const auth = { Authorization: `Bearer ${owner.accessToken}` };
      const restaurantId = await setUpRestaurant(owner.accessToken);
      const menuId = await createMenu(owner.accessToken, restaurantId);
      const category1 = await createCategory(owner.accessToken, restaurantId, menuId, 'Category 1');
      const category2 = await createCategory(owner.accessToken, restaurantId, menuId, 'Category 2');
      const item = await createItem(owner.accessToken, restaurantId, menuId, category1);

      await request(app!.getHttpServer())
        .patch(
          `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${category2}/items/${item}/availability`,
        )
        .set(auth)
        .send({ windows: [{ dayOfWeek: 1, startTime: '08:00', endTime: '11:00' }] })
        .expect(404);
    });
  });

  describe('cross-restaurant and cross-organization resource ids', () => {
    it('a resource id from Restaurant A 404s when addressed through Restaurant B (same owner, different restaurant)', async () => {
      if (!dbAvailable) return;
      const owner = await registerAndLoginOwner('cross-restaurant');
      const auth = { Authorization: `Bearer ${owner.accessToken}` };
      const restaurantA = await setUpRestaurant(owner.accessToken);
      const restaurantB = await setUpRestaurant(owner.accessToken);
      const menuId = await createMenu(owner.accessToken, restaurantA);
      const categoryId = await createCategory(owner.accessToken, restaurantA, menuId);
      const itemId = await createItem(owner.accessToken, restaurantA, menuId, categoryId);

      await request(app!.getHttpServer())
        .patch(`/api/v1/restaurants/${restaurantB}/menus/${menuId}`)
        .set(auth)
        .send({ name: 'Hijacked', displayOrder: 0 })
        .expect(404);

      await request(app!.getHttpServer())
        .patch(`/api/v1/restaurants/${restaurantB}/menus/${menuId}/categories/${categoryId}`)
        .set(auth)
        .send({ name: 'Hijacked' })
        .expect(404);

      await request(app!.getHttpServer())
        .patch(
          `/api/v1/restaurants/${restaurantB}/menus/${menuId}/categories/${categoryId}/items/${itemId}`,
        )
        .set(auth)
        .send({ name: 'Hijacked', price: 1, availabilityMode: 'Always' })
        .expect(404);
    });

    it('every management endpoint 404s for a caller from a different organization', async () => {
      if (!dbAvailable) return;
      const ownerA = await registerAndLoginOwner('cross-org-a');
      const ownerB = await registerAndLoginOwner('cross-org-b');
      const authB = { Authorization: `Bearer ${ownerB.accessToken}` };
      const restaurantId = await setUpRestaurant(ownerA.accessToken);
      const menuId = await createMenu(ownerA.accessToken, restaurantId);
      const categoryId = await createCategory(ownerA.accessToken, restaurantId, menuId);
      const itemId = await createItem(ownerA.accessToken, restaurantId, menuId, categoryId);
      const groupId = await createOptionGroup(
        ownerA.accessToken,
        restaurantId,
        menuId,
        categoryId,
        itemId,
      );
      const optionId = await createOption(
        ownerA.accessToken,
        restaurantId,
        menuId,
        categoryId,
        itemId,
        groupId,
      );
      const addOnId = await createAddOn(
        ownerA.accessToken,
        restaurantId,
        menuId,
        categoryId,
        itemId,
      );

      await request(app!.getHttpServer())
        .patch(`/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}`)
        .set(authB)
        .send({ name: 'Hijacked' })
        .expect(404);

      await request(app!.getHttpServer())
        .patch(
          `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${itemId}`,
        )
        .set(authB)
        .send({ name: 'Hijacked', price: 1, availabilityMode: 'Always' })
        .expect(404);

      await request(app!.getHttpServer())
        .patch(
          `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${itemId}/option-groups/${groupId}`,
        )
        .set(authB)
        .send({ name: 'Hijacked', required: false, minSelections: 0, maxSelections: 1 })
        .expect(404);

      await request(app!.getHttpServer())
        .patch(
          `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${itemId}/option-groups/${groupId}/options/${optionId}`,
        )
        .set(authB)
        .send({ name: 'Hijacked', priceModifier: 0, active: true })
        .expect(404);

      await request(app!.getHttpServer())
        .patch(
          `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${itemId}/add-ons/${addOnId}`,
        )
        .set(authB)
        .send({ name: 'Hijacked', price: 1, active: true })
        .expect(404);
    });
  });

  describe('soft-deleted parents reject creating new children', () => {
    it('a soft-deleted Menu rejects creating a Category under it', async () => {
      if (!dbAvailable) return;
      const owner = await registerAndLoginOwner('deleted-menu');
      const auth = { Authorization: `Bearer ${owner.accessToken}` };
      const restaurantId = await setUpRestaurant(owner.accessToken);
      const menu1 = await createMenu(owner.accessToken, restaurantId, 'Menu 1');
      // A Restaurant needs at least one non-default Menu to safely delete
      // the first without touching default-menu semantics under test here.
      await createMenu(owner.accessToken, restaurantId, 'Menu 2');
      await request(app!.getHttpServer())
        .delete(`/api/v1/restaurants/${restaurantId}/menus/${menu1}`)
        .set(auth)
        .expect(204);

      await request(app!.getHttpServer())
        .post(`/api/v1/restaurants/${restaurantId}/menus/${menu1}/categories`)
        .set(auth)
        .send({ name: 'Too Late' })
        .expect(404);
    });

    it('a soft-deleted Category rejects creating an Item under it', async () => {
      if (!dbAvailable) return;
      const owner = await registerAndLoginOwner('deleted-category');
      const auth = { Authorization: `Bearer ${owner.accessToken}` };
      const restaurantId = await setUpRestaurant(owner.accessToken);
      const menuId = await createMenu(owner.accessToken, restaurantId);
      const categoryId = await createCategory(owner.accessToken, restaurantId, menuId);
      await request(app!.getHttpServer())
        .delete(`/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}`)
        .set(auth)
        .expect(204);

      await request(app!.getHttpServer())
        .post(`/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items`)
        .set(auth)
        .send({ name: 'Too Late', price: 1 })
        .expect(404);
    });

    it('a soft-deleted Item rejects creating an OptionGroup and an AddOn under it', async () => {
      if (!dbAvailable) return;
      const owner = await registerAndLoginOwner('deleted-item');
      const auth = { Authorization: `Bearer ${owner.accessToken}` };
      const restaurantId = await setUpRestaurant(owner.accessToken);
      const menuId = await createMenu(owner.accessToken, restaurantId);
      const categoryId = await createCategory(owner.accessToken, restaurantId, menuId);
      const itemId = await createItem(owner.accessToken, restaurantId, menuId, categoryId);
      await request(app!.getHttpServer())
        .delete(
          `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${itemId}`,
        )
        .set(auth)
        .expect(204);

      await request(app!.getHttpServer())
        .post(
          `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${itemId}/option-groups`,
        )
        .set(auth)
        .send({ name: 'Too Late', required: false, minSelections: 0, maxSelections: 1 })
        .expect(404);

      await request(app!.getHttpServer())
        .post(
          `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${itemId}/add-ons`,
        )
        .set(auth)
        .send({ name: 'Too Late', price: 1 })
        .expect(404);
    });

    it('a soft-deleted OptionGroup rejects creating an Option under it', async () => {
      if (!dbAvailable) return;
      const owner = await registerAndLoginOwner('deleted-group');
      const auth = { Authorization: `Bearer ${owner.accessToken}` };
      const restaurantId = await setUpRestaurant(owner.accessToken);
      const menuId = await createMenu(owner.accessToken, restaurantId);
      const categoryId = await createCategory(owner.accessToken, restaurantId, menuId);
      const itemId = await createItem(owner.accessToken, restaurantId, menuId, categoryId);
      const groupId = await createOptionGroup(
        owner.accessToken,
        restaurantId,
        menuId,
        categoryId,
        itemId,
      );
      await request(app!.getHttpServer())
        .delete(
          `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${itemId}/option-groups/${groupId}`,
        )
        .set(auth)
        .expect(204);

      await request(app!.getHttpServer())
        .post(
          `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${itemId}/option-groups/${groupId}/options`,
        )
        .set(auth)
        .send({ name: 'Too Late', priceModifier: 0 })
        .expect(404);
    });
  });

  describe('public reads of unknown/foreign/deleted resources', () => {
    it('GET a Category id that belongs to a different Restaurant 404s', async () => {
      if (!dbAvailable) return;
      const owner = await registerAndLoginOwner('public-cross-restaurant');
      const restaurantA = await setUpRestaurant(owner.accessToken);
      const restaurantB = await setUpRestaurant(owner.accessToken);
      const menuId = await createMenu(owner.accessToken, restaurantA);
      const categoryId = await createCategory(owner.accessToken, restaurantA, menuId);

      await request(app!.getHttpServer())
        .get(`/api/v1/restaurants/${restaurantB}/menus/${menuId}/categories/${categoryId}`)
        .expect(404);
    });

    it('GET a soft-deleted Item 404s on the public read', async () => {
      if (!dbAvailable) return;
      const owner = await registerAndLoginOwner('public-deleted-item');
      const auth = { Authorization: `Bearer ${owner.accessToken}` };
      const restaurantId = await setUpRestaurant(owner.accessToken);
      const menuId = await createMenu(owner.accessToken, restaurantId);
      const categoryId = await createCategory(owner.accessToken, restaurantId, menuId);
      const itemId = await createItem(owner.accessToken, restaurantId, menuId, categoryId);
      await request(app!.getHttpServer())
        .delete(
          `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${itemId}`,
        )
        .set(auth)
        .expect(204);

      await request(app!.getHttpServer())
        .get(
          `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${itemId}`,
        )
        .expect(404);
    });
  });
});
