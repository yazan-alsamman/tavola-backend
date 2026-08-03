import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaRestaurantRepository } from '@modules/restaurants/infrastructure/persistence/prisma-restaurant.repository';
import { PrismaMenuRepository } from '@modules/menus/infrastructure/persistence/prisma-menu.repository';
import { PrismaMenuCategoryRepository } from '@modules/menus/infrastructure/persistence/prisma-menu-category.repository';
import { PrismaMenuItemRepository } from '@modules/menus/infrastructure/persistence/prisma-menu-item.repository';
import { PrismaMenuItemAvailabilityRepository } from '@modules/menus/infrastructure/persistence/prisma-menu-item-availability.repository';
import { PrismaMenuItemOptionGroupRepository } from '@modules/menus/infrastructure/persistence/prisma-menu-item-option-group.repository';
import { PrismaMenuItemOptionRepository } from '@modules/menus/infrastructure/persistence/prisma-menu-item-option.repository';
import { PrismaMenuItemAddOnRepository } from '@modules/menus/infrastructure/persistence/prisma-menu-item-add-on.repository';
import { Menu } from '@modules/menus/domain/entities/menu.entity';
import { MenuCategory } from '@modules/menus/domain/entities/menu-category.entity';
import { MenuItem } from '@modules/menus/domain/entities/menu-item.entity';
import { MenuItemAvailability } from '@modules/menus/domain/entities/menu-item-availability.entity';
import { MenuItemOptionGroup } from '@modules/menus/domain/entities/menu-item-option-group.entity';
import { MenuItemOption } from '@modules/menus/domain/entities/menu-item-option.entity';
import { MenuItemAddOn } from '@modules/menus/domain/entities/menu-item-add-on.entity';
import { MenuItemDietaryLabel } from '@modules/menus/domain/enums/menu-item.enums';
import { TenantContextMissingException } from '@infrastructure/tenancy/tenant-context-missing.exception';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'menu-repo-';
const NOW = new Date('2026-08-03T00:00:00.000Z');

/**
 * Phase 18 (Menu Management, ADR-031/ADR-032, implemented 2026-08-03) -
 * proves every one of the seven Menu-family Prisma repositories against real
 * PostgreSQL: the partial unique index `menus_restaurant_one_default_key`
 * genuinely exists and is enforced at the database level (not merely
 * application logic), `setAsDefault`'s atomic unset-old/set-new pair, the
 * transitive-tenancy IDOR proof (foreign restaurantId collapses to null) for
 * every child model, soft-delete exclusion, and the shared
 * Restaurant-resolution gate every Menu use case depends on for the
 * "no tenant context bound" failure mode (TENANCY.md's own testing
 * requirement, applied per-model exactly as it already is for Menu/MenuCategory).
 *
 * Each test gets its own fresh Restaurant (not a suite-wide shared one) so
 * the per-restaurant "one default Menu" invariant under test never leaks
 * state between assertions.
 */
describe('Menu round-trip via Prisma repositories (integration)', () => {
  let dbAvailable = false;
  let menuRepository: PrismaMenuRepository;
  let categoryRepository: PrismaMenuCategoryRepository;
  let itemRepository: PrismaMenuItemRepository;
  let availabilityRepository: PrismaMenuItemAvailabilityRepository;
  let optionGroupRepository: PrismaMenuItemOptionGroupRepository;
  let optionRepository: PrismaMenuItemOptionRepository;
  let addOnRepository: PrismaMenuItemAddOnRepository;
  let restaurantRepositoryNoContext: PrismaRestaurantRepository;
  const createdRestaurantIds: string[] = [];
  const createdOrgIds: string[] = [];

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([
      PrismaMenuRepository,
      PrismaMenuCategoryRepository,
      PrismaMenuItemRepository,
      PrismaMenuItemAvailabilityRepository,
      PrismaMenuItemOptionGroupRepository,
      PrismaMenuItemOptionRepository,
      PrismaMenuItemAddOnRepository,
      PrismaRestaurantRepository,
    ]);
    menuRepository = moduleRef.get(PrismaMenuRepository);
    categoryRepository = moduleRef.get(PrismaMenuCategoryRepository);
    itemRepository = moduleRef.get(PrismaMenuItemRepository);
    availabilityRepository = moduleRef.get(PrismaMenuItemAvailabilityRepository);
    optionGroupRepository = moduleRef.get(PrismaMenuItemOptionGroupRepository);
    optionRepository = moduleRef.get(PrismaMenuItemOptionRepository);
    addOnRepository = moduleRef.get(PrismaMenuItemAddOnRepository);
    // Deliberately resolved OUTSIDE any TenantContextService.run()/runAsync()
    // call - no interceptor has bound a context here, exactly the "no
    // TenantContextInterceptor ran yet" state a request reaching this far
    // without authentication would be in.
    restaurantRepositoryNoContext = moduleRef.get(PrismaRestaurantRepository);
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    await rawPrisma.menuItemOption.deleteMany({
      where: { restaurantId: { in: createdRestaurantIds } },
    });
    await rawPrisma.menuItemOptionGroup.deleteMany({
      where: { restaurantId: { in: createdRestaurantIds } },
    });
    await rawPrisma.menuItemAddOn.deleteMany({
      where: { restaurantId: { in: createdRestaurantIds } },
    });
    await rawPrisma.menuItemAvailability.deleteMany({
      where: { restaurantId: { in: createdRestaurantIds } },
    });
    await rawPrisma.menuItem.deleteMany({ where: { restaurantId: { in: createdRestaurantIds } } });
    await rawPrisma.menuCategory.deleteMany({
      where: { restaurantId: { in: createdRestaurantIds } },
    });
    await rawPrisma.menu.deleteMany({ where: { restaurantId: { in: createdRestaurantIds } } });
    await rawPrisma.restaurant.deleteMany({ where: { id: { in: createdRestaurantIds } } });
    await rawPrisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
    await rawPrisma.$disconnect();
  });

  async function createFreshRestaurant(): Promise<string> {
    const org = await rawPrisma.organization.create({
      data: {
        name: 'Menu Repo Test Org',
        slug: `${TEST_PREFIX}org-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}@example.com`,
      },
    });
    createdOrgIds.push(org.id);
    const restaurant = await rawPrisma.restaurant.create({
      data: {
        organizationId: org.id,
        name: 'Menu Repo Test Restaurant',
        slug: `${TEST_PREFIX}restaurant-${randomUUID()}`,
        status: 'Active',
      },
    });
    createdRestaurantIds.push(restaurant.id);
    return restaurant.id;
  }

  function makeMenu(restaurantId: string, overrides?: { id?: string; isDefault?: boolean }): Menu {
    return Menu.create({
      id: overrides?.id ?? randomUUID(),
      restaurantId,
      name: 'Repo Test Menu',
      isDefault: overrides?.isDefault ?? false,
      now: NOW,
    });
  }

  async function seedMenuAndCategory(
    restaurantId: string,
  ): Promise<{ menu: Menu; category: MenuCategory }> {
    const menu = makeMenu(restaurantId, { isDefault: true });
    await menuRepository.create(menu);
    const category = MenuCategory.create({
      id: randomUUID(),
      menuId: menu.menuId.value,
      restaurantId,
      content: { name: 'Appetizers', description: null },
      displayOrder: 0,
      now: NOW,
    });
    await categoryRepository.create(category);
    return { menu, category };
  }

  function makeItem(
    categoryId: string,
    restaurantId: string,
    overrides?: { id?: string },
  ): MenuItem {
    return MenuItem.create({
      id: overrides?.id ?? randomUUID(),
      categoryId,
      restaurantId,
      content: {
        name: 'Repo Test Item',
        description: null,
        price: 10,
        currency: 'USD',
        preparationTimeMinutes: null,
        spicyLevel: null,
        calories: null,
        allergens: [],
        dietaryLabels: [] as MenuItemDietaryLabel[],
      },
      displayOrder: 0,
      now: NOW,
    });
  }

  /**
   * TENANCY.md's "no bound TenantContext throws" requirement, applied at the
   * one point every Menu use case actually enforces it: resolving the parent
   * Restaurant through the tenant-scoped `RestaurantRepository` before ever
   * touching a Menu-family row. Menu-family repositories themselves are not
   * in `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS` (their own doc
   * comments explain why: `PrismaContext.client` is a safe no-op passthrough
   * for them) - so this is the correct, honest place to prove the
   * fail-closed behavior, not a per-child-repository check that would not
   * actually exist.
   */
  async function expectMissingContextRejection(): Promise<void> {
    await expect(
      restaurantRepositoryNoContext.findById(RestaurantId.create(randomUUID())),
    ).rejects.toBeInstanceOf(TenantContextMissingException);
  }

  it('persists and round-trips every field', async () => {
    if (!dbAvailable) return;
    const restaurantId = await createFreshRestaurant();
    const menu = makeMenu(restaurantId, { isDefault: true });
    await menuRepository.create(menu);

    const found = await menuRepository.findByIdAndRestaurantId(
      menu.menuId,
      RestaurantId.create(restaurantId),
    );
    expect(found).not.toBeNull();
    expect(found?.name).toBe('Repo Test Menu');
    expect(found?.isDefault).toBe(true);
  });

  it('findByIdAndRestaurantId returns null for a foreign restaurantId (transitive-tenancy IDOR proof)', async () => {
    if (!dbAvailable) return;
    const restaurantId = await createFreshRestaurant();
    const otherRestaurantId = await createFreshRestaurant();
    const menu = makeMenu(restaurantId);
    await menuRepository.create(menu);

    const found = await menuRepository.findByIdAndRestaurantId(
      menu.menuId,
      RestaurantId.create(otherRestaurantId),
    );
    expect(found).toBeNull();
  });

  it('the partial unique index rejects a second isDefault=true row for the same restaurant at the raw SQL level', async () => {
    if (!dbAvailable) return;
    const restaurantId = await createFreshRestaurant();
    const first = makeMenu(restaurantId, { isDefault: true });
    const second = makeMenu(restaurantId, { isDefault: false });
    await menuRepository.create(first);
    await menuRepository.create(second);

    // Bypass the repository's own setAsDefault entirely - prove the
    // database CONSTRAINT itself is the authority, not just application code.
    await expect(
      rawPrisma.menu.update({ where: { id: second.menuId.value }, data: { isDefault: true } }),
    ).rejects.toThrow(/Unique constraint/i);
  });

  it('setAsDefault atomically unmarks the prior default and marks the new one, both inside one call', async () => {
    if (!dbAvailable) return;
    const restaurantId = await createFreshRestaurant();
    const first = makeMenu(restaurantId, { isDefault: true });
    const second = makeMenu(restaurantId, { isDefault: false });
    await menuRepository.create(first);
    await menuRepository.create(second);

    await menuRepository.setAsDefault(
      second.menuId,
      RestaurantId.create(restaurantId),
      new Date('2026-08-03T01:00:00.000Z'),
    );

    const reloadedFirst = await menuRepository.findByIdAndRestaurantId(
      first.menuId,
      RestaurantId.create(restaurantId),
    );
    const reloadedSecond = await menuRepository.findByIdAndRestaurantId(
      second.menuId,
      RestaurantId.create(restaurantId),
    );
    expect(reloadedFirst?.isDefault).toBe(false);
    expect(reloadedSecond?.isDefault).toBe(true);
  });

  it('softDelete excludes the Menu from findByIdAndRestaurantId but leaves the row in place', async () => {
    if (!dbAvailable) return;
    const restaurantId = await createFreshRestaurant();
    const menu = makeMenu(restaurantId);
    await menuRepository.create(menu);
    await menuRepository.softDelete(menu.menuId, new Date('2026-08-03T02:00:00.000Z'));

    const found = await menuRepository.findByIdAndRestaurantId(
      menu.menuId,
      RestaurantId.create(restaurantId),
    );
    expect(found).toBeNull();

    const rawRow = await rawPrisma.menu.findUnique({ where: { id: menu.menuId.value } });
    expect(rawRow).not.toBeNull();
    expect(rawRow?.deletedAt).not.toBeNull();
  });

  it('findRestaurantIdsWithActiveDefaultMenu returns only restaurants with an active, non-deleted, isDefault Menu', async () => {
    if (!dbAvailable) return;
    const restaurantId = await createFreshRestaurant();
    const otherRestaurantId = await createFreshRestaurant();
    const withDefault = makeMenu(restaurantId, { isDefault: true });
    await menuRepository.create(withDefault);

    const found = await menuRepository.findRestaurantIdsWithActiveDefaultMenu([
      RestaurantId.create(restaurantId),
      RestaurantId.create(otherRestaurantId),
    ]);
    expect(found.has(restaurantId)).toBe(true);
    expect(found.has(otherRestaurantId)).toBe(false);
  });

  it('rejects Restaurant resolution with no tenant context bound (the shared gate every Menu use case relies on)', async () => {
    if (!dbAvailable) return;
    await expectMissingContextRejection();
  });

  describe('MenuCategory (transitively-tenant-owned, one hop through the denormalized restaurantId)', () => {
    it('findByIdAndRestaurantId returns null for a foreign restaurantId even though the category exists', async () => {
      if (!dbAvailable) return;
      const restaurantId = await createFreshRestaurant();
      const otherRestaurantId = await createFreshRestaurant();
      const { category } = await seedMenuAndCategory(restaurantId);

      const found = await categoryRepository.findByIdAndRestaurantId(
        category.menuCategoryId,
        RestaurantId.create(otherRestaurantId),
      );
      expect(found).toBeNull();

      const foundCorrectly = await categoryRepository.findByIdAndRestaurantId(
        category.menuCategoryId,
        RestaurantId.create(restaurantId),
      );
      expect(foundCorrectly).not.toBeNull();
    });

    it('softDelete excludes the Category from findByIdAndRestaurantId but leaves the row in place', async () => {
      if (!dbAvailable) return;
      const restaurantId = await createFreshRestaurant();
      const { category } = await seedMenuAndCategory(restaurantId);
      await categoryRepository.softDelete(
        category.menuCategoryId,
        new Date('2026-08-03T02:00:00.000Z'),
      );

      const found = await categoryRepository.findByIdAndRestaurantId(
        category.menuCategoryId,
        RestaurantId.create(restaurantId),
      );
      expect(found).toBeNull();

      const rawRow = await rawPrisma.menuCategory.findUnique({
        where: { id: category.menuCategoryId.value },
      });
      expect(rawRow).not.toBeNull();
      expect(rawRow?.deletedAt).not.toBeNull();
    });

    it('reorder bulk-replaces displayOrder for the whole set in one call', async () => {
      if (!dbAvailable) return;
      const restaurantId = await createFreshRestaurant();
      const menu = makeMenu(restaurantId, { isDefault: true });
      await menuRepository.create(menu);
      const categories = await Promise.all(
        ['a', 'b', 'c'].map((name, index) => {
          const category = MenuCategory.create({
            id: randomUUID(),
            menuId: menu.menuId.value,
            restaurantId,
            content: { name, description: null },
            displayOrder: index,
            now: NOW,
          });
          return categoryRepository.create(category).then(() => category);
        }),
      );

      const reversedIds = [...categories].reverse().map((c) => c.menuCategoryId);
      await categoryRepository.reorder(reversedIds, new Date('2026-08-03T03:00:00.000Z'));

      const reloaded = await categoryRepository.findManyByMenuId(menu.menuId);
      expect(reloaded.map((c) => c.menuCategoryId.value)).toEqual(
        reversedIds.map((id) => id.value),
      );
    });

    it('rejects Restaurant resolution with no tenant context bound', async () => {
      if (!dbAvailable) return;
      await expectMissingContextRejection();
    });
  });

  describe('MenuItem (transitively-tenant-owned, denormalized restaurantId)', () => {
    it('findByIdAndRestaurantId returns null for a foreign restaurantId even though the item exists', async () => {
      if (!dbAvailable) return;
      const restaurantId = await createFreshRestaurant();
      const otherRestaurantId = await createFreshRestaurant();
      const { category } = await seedMenuAndCategory(restaurantId);
      const item = makeItem(category.menuCategoryId.value, restaurantId);
      await itemRepository.create(item);

      const found = await itemRepository.findByIdAndRestaurantId(
        item.menuItemId,
        RestaurantId.create(otherRestaurantId),
      );
      expect(found).toBeNull();

      const foundCorrectly = await itemRepository.findByIdAndRestaurantId(
        item.menuItemId,
        RestaurantId.create(restaurantId),
      );
      expect(foundCorrectly).not.toBeNull();
    });

    it('softDelete excludes the Item from findByIdAndRestaurantId but leaves the row in place', async () => {
      if (!dbAvailable) return;
      const restaurantId = await createFreshRestaurant();
      const { category } = await seedMenuAndCategory(restaurantId);
      const item = makeItem(category.menuCategoryId.value, restaurantId);
      await itemRepository.create(item);
      await itemRepository.softDelete(item.menuItemId, new Date('2026-08-03T02:00:00.000Z'));

      const found = await itemRepository.findByIdAndRestaurantId(
        item.menuItemId,
        RestaurantId.create(restaurantId),
      );
      expect(found).toBeNull();

      const rawRow = await rawPrisma.menuItem.findUnique({ where: { id: item.menuItemId.value } });
      expect(rawRow).not.toBeNull();
      expect(rawRow?.deletedAt).not.toBeNull();
    });

    it('reorder bulk-replaces displayOrder for the whole set in one call', async () => {
      if (!dbAvailable) return;
      const restaurantId = await createFreshRestaurant();
      const { category } = await seedMenuAndCategory(restaurantId);
      const items = await Promise.all(
        ['a', 'b', 'c'].map((name, index) => {
          const item = MenuItem.create({
            id: randomUUID(),
            categoryId: category.menuCategoryId.value,
            restaurantId,
            content: {
              name,
              description: null,
              price: 5,
              currency: null,
              preparationTimeMinutes: null,
              spicyLevel: null,
              calories: null,
              allergens: [],
              dietaryLabels: [] as MenuItemDietaryLabel[],
            },
            displayOrder: index,
            now: NOW,
          });
          return itemRepository.create(item).then(() => item);
        }),
      );

      const reversedIds = [...items].reverse().map((i) => i.menuItemId);
      await itemRepository.reorder(reversedIds, new Date('2026-08-03T03:00:00.000Z'));

      const reloaded = await itemRepository.findManyByCategoryId(category.menuCategoryId);
      expect(reloaded.map((i) => i.menuItemId.value)).toEqual(reversedIds.map((id) => id.value));
    });

    it('rejects Restaurant resolution with no tenant context bound', async () => {
      if (!dbAvailable) return;
      await expectMissingContextRejection();
    });
  });

  describe('MenuItemAvailability (no deletedAt - whole-set replaced, matching WorkingHours/BranchWorkingHours)', () => {
    it('replaceForMenuItem persists the denormalized restaurantId on every row and stays scoped per-Item', async () => {
      if (!dbAvailable) return;
      const restaurantId = await createFreshRestaurant();
      const otherRestaurantId = await createFreshRestaurant();
      const { category } = await seedMenuAndCategory(restaurantId);
      const item = makeItem(category.menuCategoryId.value, restaurantId);
      await itemRepository.create(item);
      const { category: otherCategory } = await seedMenuAndCategory(otherRestaurantId);
      const otherItem = makeItem(otherCategory.menuCategoryId.value, otherRestaurantId);
      await itemRepository.create(otherItem);

      const window = MenuItemAvailability.create({
        id: randomUUID(),
        menuItemId: item.menuItemId.value,
        restaurantId,
        dayOfWeek: 1,
        startTime: '08:00',
        endTime: '11:00',
        now: NOW,
      });
      const otherWindow = MenuItemAvailability.create({
        id: randomUUID(),
        menuItemId: otherItem.menuItemId.value,
        restaurantId: otherRestaurantId,
        dayOfWeek: 2,
        startTime: '09:00',
        endTime: '10:00',
        now: NOW,
      });
      await availabilityRepository.replaceForMenuItem(item.menuItemId, [window]);
      await availabilityRepository.replaceForMenuItem(otherItem.menuItemId, [otherWindow]);

      const found = await availabilityRepository.findManyByMenuItemId(item.menuItemId);
      expect(found).toHaveLength(1);
      expect(found[0].dayOfWeek).toBe(1);

      const rawRow = await rawPrisma.menuItemAvailability.findFirst({
        where: { menuItemId: item.menuItemId.value },
      });
      expect(rawRow?.restaurantId).toBe(restaurantId);

      // Querying the other Item's availability never returns this Item's rows.
      const otherFound = await availabilityRepository.findManyByMenuItemId(otherItem.menuItemId);
      expect(otherFound).toHaveLength(1);
      expect(otherFound[0].dayOfWeek).toBe(2);
    });

    it('replaceForMenuItem deletes the prior set before inserting the new one (whole-set replacement, not merge)', async () => {
      if (!dbAvailable) return;
      const restaurantId = await createFreshRestaurant();
      const { category } = await seedMenuAndCategory(restaurantId);
      const item = makeItem(category.menuCategoryId.value, restaurantId);
      await itemRepository.create(item);

      const firstWindow = MenuItemAvailability.create({
        id: randomUUID(),
        menuItemId: item.menuItemId.value,
        restaurantId,
        dayOfWeek: 1,
        startTime: '08:00',
        endTime: '11:00',
        now: NOW,
      });
      await availabilityRepository.replaceForMenuItem(item.menuItemId, [firstWindow]);

      const secondWindow = MenuItemAvailability.create({
        id: randomUUID(),
        menuItemId: item.menuItemId.value,
        restaurantId,
        dayOfWeek: 3,
        startTime: '18:00',
        endTime: '22:00',
        now: NOW,
      });
      await availabilityRepository.replaceForMenuItem(item.menuItemId, [secondWindow]);

      const found = await availabilityRepository.findManyByMenuItemId(item.menuItemId);
      expect(found).toHaveLength(1);
      expect(found[0].dayOfWeek).toBe(3);
    });

    it('deleteAllForMenuItem clears every window ("deletion removes references correctly")', async () => {
      if (!dbAvailable) return;
      const restaurantId = await createFreshRestaurant();
      const { category } = await seedMenuAndCategory(restaurantId);
      const item = makeItem(category.menuCategoryId.value, restaurantId);
      await itemRepository.create(item);
      const window = MenuItemAvailability.create({
        id: randomUUID(),
        menuItemId: item.menuItemId.value,
        restaurantId,
        dayOfWeek: 1,
        startTime: '08:00',
        endTime: '11:00',
        now: NOW,
      });
      await availabilityRepository.replaceForMenuItem(item.menuItemId, [window]);

      await availabilityRepository.deleteAllForMenuItem(item.menuItemId);

      const found = await availabilityRepository.findManyByMenuItemId(item.menuItemId);
      expect(found).toHaveLength(0);
    });

    it('rejects Restaurant resolution with no tenant context bound', async () => {
      if (!dbAvailable) return;
      await expectMissingContextRejection();
    });
  });

  describe('MenuItemOptionGroup (owned by MenuItem)', () => {
    it('findByIdAndRestaurantId returns null for a foreign restaurantId even though the group exists', async () => {
      if (!dbAvailable) return;
      const restaurantId = await createFreshRestaurant();
      const otherRestaurantId = await createFreshRestaurant();
      const { category } = await seedMenuAndCategory(restaurantId);
      const item = makeItem(category.menuCategoryId.value, restaurantId);
      await itemRepository.create(item);
      const group = MenuItemOptionGroup.create({
        id: randomUUID(),
        menuItemId: item.menuItemId.value,
        restaurantId,
        content: { name: 'Size', required: true, minSelections: 1, maxSelections: 1 },
        displayOrder: 0,
        now: NOW,
      });
      await optionGroupRepository.create(group);

      const found = await optionGroupRepository.findByIdAndRestaurantId(
        group.optionGroupId,
        RestaurantId.create(otherRestaurantId),
      );
      expect(found).toBeNull();

      const foundCorrectly = await optionGroupRepository.findByIdAndRestaurantId(
        group.optionGroupId,
        RestaurantId.create(restaurantId),
      );
      expect(foundCorrectly).not.toBeNull();
    });

    it('softDelete excludes the Option Group from findByIdAndRestaurantId but leaves the row in place', async () => {
      if (!dbAvailable) return;
      const restaurantId = await createFreshRestaurant();
      const { category } = await seedMenuAndCategory(restaurantId);
      const item = makeItem(category.menuCategoryId.value, restaurantId);
      await itemRepository.create(item);
      const group = MenuItemOptionGroup.create({
        id: randomUUID(),
        menuItemId: item.menuItemId.value,
        restaurantId,
        content: { name: 'Size', required: false, minSelections: 0, maxSelections: 1 },
        displayOrder: 0,
        now: NOW,
      });
      await optionGroupRepository.create(group);
      await optionGroupRepository.softDelete(
        group.optionGroupId,
        new Date('2026-08-03T02:00:00.000Z'),
      );

      const found = await optionGroupRepository.findByIdAndRestaurantId(
        group.optionGroupId,
        RestaurantId.create(restaurantId),
      );
      expect(found).toBeNull();

      const rawRow = await rawPrisma.menuItemOptionGroup.findUnique({
        where: { id: group.optionGroupId.value },
      });
      expect(rawRow).not.toBeNull();
      expect(rawRow?.deletedAt).not.toBeNull();
    });

    it('rejects Restaurant resolution with no tenant context bound', async () => {
      if (!dbAvailable) return;
      await expectMissingContextRejection();
    });
  });

  describe('MenuItemOption (owned by MenuItemOptionGroup)', () => {
    async function seedOptionGroup(restaurantId: string) {
      const { category } = await seedMenuAndCategory(restaurantId);
      const item = makeItem(category.menuCategoryId.value, restaurantId);
      await itemRepository.create(item);
      const group = MenuItemOptionGroup.create({
        id: randomUUID(),
        menuItemId: item.menuItemId.value,
        restaurantId,
        content: { name: 'Size', required: true, minSelections: 1, maxSelections: 1 },
        displayOrder: 0,
        now: NOW,
      });
      await optionGroupRepository.create(group);
      return group;
    }

    it('findByIdAndRestaurantId returns null for a foreign restaurantId even though the option exists', async () => {
      if (!dbAvailable) return;
      const restaurantId = await createFreshRestaurant();
      const otherRestaurantId = await createFreshRestaurant();
      const group = await seedOptionGroup(restaurantId);
      const option = MenuItemOption.create({
        id: randomUUID(),
        optionGroupId: group.optionGroupId.value,
        restaurantId,
        content: { name: 'Large', priceModifier: 3 },
        displayOrder: 0,
        now: NOW,
      });
      await optionRepository.create(option);

      const found = await optionRepository.findByIdAndRestaurantId(
        option.menuItemOptionId,
        RestaurantId.create(otherRestaurantId),
      );
      expect(found).toBeNull();

      const foundCorrectly = await optionRepository.findByIdAndRestaurantId(
        option.menuItemOptionId,
        RestaurantId.create(restaurantId),
      );
      expect(foundCorrectly).not.toBeNull();
    });

    it('softDelete excludes the Option from findByIdAndRestaurantId but leaves the row in place', async () => {
      if (!dbAvailable) return;
      const restaurantId = await createFreshRestaurant();
      const group = await seedOptionGroup(restaurantId);
      const option = MenuItemOption.create({
        id: randomUUID(),
        optionGroupId: group.optionGroupId.value,
        restaurantId,
        content: { name: 'Large', priceModifier: 3 },
        displayOrder: 0,
        now: NOW,
      });
      await optionRepository.create(option);
      await optionRepository.softDelete(
        option.menuItemOptionId,
        new Date('2026-08-03T02:00:00.000Z'),
      );

      const found = await optionRepository.findByIdAndRestaurantId(
        option.menuItemOptionId,
        RestaurantId.create(restaurantId),
      );
      expect(found).toBeNull();

      const rawRow = await rawPrisma.menuItemOption.findUnique({
        where: { id: option.menuItemOptionId.value },
      });
      expect(rawRow).not.toBeNull();
      expect(rawRow?.deletedAt).not.toBeNull();
    });

    it('rejects Restaurant resolution with no tenant context bound', async () => {
      if (!dbAvailable) return;
      await expectMissingContextRejection();
    });
  });

  describe('MenuItemAddOn (owned by MenuItem, sibling of MenuItemOptionGroup)', () => {
    it('findByIdAndRestaurantId returns null for a foreign restaurantId even though the add-on exists', async () => {
      if (!dbAvailable) return;
      const restaurantId = await createFreshRestaurant();
      const otherRestaurantId = await createFreshRestaurant();
      const { category } = await seedMenuAndCategory(restaurantId);
      const item = makeItem(category.menuCategoryId.value, restaurantId);
      await itemRepository.create(item);
      const addOn = MenuItemAddOn.create({
        id: randomUUID(),
        menuItemId: item.menuItemId.value,
        restaurantId,
        content: { name: 'Extra Cheese', price: 1.5 },
        displayOrder: 0,
        now: NOW,
      });
      await addOnRepository.create(addOn);

      const found = await addOnRepository.findByIdAndRestaurantId(
        addOn.menuItemAddOnId,
        RestaurantId.create(otherRestaurantId),
      );
      expect(found).toBeNull();

      const foundCorrectly = await addOnRepository.findByIdAndRestaurantId(
        addOn.menuItemAddOnId,
        RestaurantId.create(restaurantId),
      );
      expect(foundCorrectly).not.toBeNull();
    });

    it('softDelete excludes the Add-on from findByIdAndRestaurantId but leaves the row in place', async () => {
      if (!dbAvailable) return;
      const restaurantId = await createFreshRestaurant();
      const { category } = await seedMenuAndCategory(restaurantId);
      const item = makeItem(category.menuCategoryId.value, restaurantId);
      await itemRepository.create(item);
      const addOn = MenuItemAddOn.create({
        id: randomUUID(),
        menuItemId: item.menuItemId.value,
        restaurantId,
        content: { name: 'Extra Cheese', price: 1.5 },
        displayOrder: 0,
        now: NOW,
      });
      await addOnRepository.create(addOn);
      await addOnRepository.softDelete(addOn.menuItemAddOnId, new Date('2026-08-03T02:00:00.000Z'));

      const found = await addOnRepository.findByIdAndRestaurantId(
        addOn.menuItemAddOnId,
        RestaurantId.create(restaurantId),
      );
      expect(found).toBeNull();

      const rawRow = await rawPrisma.menuItemAddOn.findUnique({
        where: { id: addOn.menuItemAddOnId.value },
      });
      expect(rawRow).not.toBeNull();
      expect(rawRow?.deletedAt).not.toBeNull();
    });

    it('rejects Restaurant resolution with no tenant context bound', async () => {
      if (!dbAvailable) return;
      await expectMissingContextRejection();
    });
  });
});
