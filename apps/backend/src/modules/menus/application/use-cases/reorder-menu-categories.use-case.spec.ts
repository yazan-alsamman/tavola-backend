import { ReorderMenuCategoriesUseCase } from './reorder-menu-categories.use-case';
import { Menu } from '../../domain/entities/menu.entity';
import { MenuCategory } from '../../domain/entities/menu-category.entity';
import { MenuReorderSetMismatchException } from '../../domain/exceptions/menu-reorder-set-mismatch.exception';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryMenuRepository } from '../../../../../test/menus/support/in-memory-menu.repository';
import { InMemoryMenuCategoryRepository } from '../../../../../test/menus/support/in-memory-menu-category.repository';
import {
  FIXED_NOW,
  RESTAURANT_ID,
  testRestaurant,
  ownerActor,
} from '../../../../../test/menus/support/menu-test-fixtures';

describe('ReorderMenuCategoriesUseCase (API_GUIDELINES.md Bulk Reorder)', () => {
  function build() {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const menuRepository = new InMemoryMenuRepository();
    const categoryRepository = new InMemoryMenuCategoryRepository();
    const useCase = new ReorderMenuCategoriesUseCase(
      restaurantRepository,
      menuRepository,
      categoryRepository,
      new FixedClock(FIXED_NOW),
      new SequentialIdGenerator(['aaaaaaaa-0001-4000-8000-000000000001']),
      new CollectingEventPublisher(),
      new ImmediateUnitOfWork(),
    );
    return { useCase, restaurantRepository, menuRepository, categoryRepository };
  }

  async function seedMenuWithCategories(
    menuRepository: InMemoryMenuRepository,
    categoryRepository: InMemoryMenuCategoryRepository,
  ) {
    const menu = Menu.create({
      id: '10000000-0000-4000-8000-000000000001',
      restaurantId: RESTAURANT_ID,
      isDefault: true,
      now: FIXED_NOW,
    });
    await menuRepository.create(menu);
    const categories = ['a', 'b', 'c'].map((label, index) =>
      MenuCategory.create({
        id: `2000000${index}-0000-4000-8000-00000000000${index}`,
        menuId: menu.menuId.value,
        restaurantId: RESTAURANT_ID,
        content: { name: label, description: null },
        displayOrder: index,
        now: FIXED_NOW,
      }),
    );
    for (const category of categories) {
      await categoryRepository.create(category);
    }
    return { menu, categories };
  }

  it('reorders the whole set when orderedIds is an exact match', async () => {
    const { useCase, restaurantRepository, menuRepository, categoryRepository } = build();
    await restaurantRepository.save(testRestaurant());
    const { menu, categories } = await seedMenuWithCategories(menuRepository, categoryRepository);

    const reversedIds = [...categories].reverse().map((c) => c.menuCategoryId.value);
    const result = await useCase.execute({
      actor: ownerActor(),
      restaurantId: RESTAURANT_ID,
      menuId: menu.menuId.value,
      orderedCategoryIds: reversedIds,
    });

    expect(result.map((r) => r.id)).toEqual(reversedIds);
    expect(result.map((r) => r.displayOrder)).toEqual([0, 1, 2]);
  });

  it('rejects a partial array (missing a sibling id)', async () => {
    const { useCase, restaurantRepository, menuRepository, categoryRepository } = build();
    await restaurantRepository.save(testRestaurant());
    const { menu, categories } = await seedMenuWithCategories(menuRepository, categoryRepository);

    await expect(
      useCase.execute({
        actor: ownerActor(),
        restaurantId: RESTAURANT_ID,
        menuId: menu.menuId.value,
        orderedCategoryIds: [
          categories[0].menuCategoryId.value,
          categories[1].menuCategoryId.value,
        ],
      }),
    ).rejects.toBeInstanceOf(MenuReorderSetMismatchException);
  });

  it('rejects a foreign id belonging to a different Menu', async () => {
    const { useCase, restaurantRepository, menuRepository, categoryRepository } = build();
    await restaurantRepository.save(testRestaurant());
    const { menu, categories } = await seedMenuWithCategories(menuRepository, categoryRepository);

    const foreignId = '99999999-0000-4000-8000-000000000099';
    await expect(
      useCase.execute({
        actor: ownerActor(),
        restaurantId: RESTAURANT_ID,
        menuId: menu.menuId.value,
        orderedCategoryIds: [...categories.map((c) => c.menuCategoryId.value), foreignId],
      }),
    ).rejects.toBeInstanceOf(MenuReorderSetMismatchException);
  });
});
