import { SetDefaultMenuUseCase } from './set-default-menu.use-case';
import { Menu } from '../../domain/entities/menu.entity';
import { MenuId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { MenuNotFoundException } from '../../domain/exceptions/menu-not-found.exception';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryMenuRepository } from '../../../../../test/menus/support/in-memory-menu.repository';
import { CountingPriceLevelScheduler } from '../../../../../test/menus/support/counting-price-level-scheduler';
import {
  FIXED_NOW,
  RESTAURANT_ID,
  testRestaurant,
  ownerActor,
} from '../../../../../test/menus/support/menu-test-fixtures';

describe('SetDefaultMenuUseCase (ADR-032)', () => {
  function build() {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const priceLevelScheduler = new CountingPriceLevelScheduler();
    const menuRepository = new InMemoryMenuRepository();
    const useCase = new SetDefaultMenuUseCase(
      restaurantRepository,
      menuRepository,
      new FixedClock(FIXED_NOW),
      new SequentialIdGenerator(['aaaaaaaa-0001-4000-8000-000000000001']),
      new CollectingEventPublisher(),
      new ImmediateUnitOfWork(),
      priceLevelScheduler,
    );
    return { useCase, restaurantRepository, menuRepository, priceLevelScheduler };
  }

  it('atomically unmarks the prior default Menu when a new one is promoted', async () => {
    const { useCase, restaurantRepository, menuRepository } = build();
    await restaurantRepository.save(testRestaurant());

    const first = Menu.create({
      id: '10000000-0000-4000-8000-000000000001',
      restaurantId: RESTAURANT_ID,
      name: 'Breakfast',
      isDefault: true,
      now: FIXED_NOW,
    });
    const second = Menu.create({
      id: '10000000-0000-4000-8000-000000000002',
      restaurantId: RESTAURANT_ID,
      name: 'Dinner',
      isDefault: false,
      now: FIXED_NOW,
    });
    await menuRepository.create(first);
    await menuRepository.create(second);

    await useCase.execute({
      actor: ownerActor(),
      restaurantId: RESTAURANT_ID,
      menuId: second.menuId.value,
    });

    const reloadedFirst = await menuRepository.findByIdAndRestaurantId(
      first.menuId,
      RestaurantId.create(RESTAURANT_ID),
    );
    const reloadedSecond = await menuRepository.findByIdAndRestaurantId(
      second.menuId,
      RestaurantId.create(RESTAURANT_ID),
    );
    expect(reloadedFirst?.isDefault).toBe(false);
    expect(reloadedSecond?.isDefault).toBe(true);
  });

  it('keeps a branch default when the shared default changes, and asks for new price levels (ADR-046)', async () => {
    const { useCase, restaurantRepository, menuRepository, priceLevelScheduler } = build();
    await restaurantRepository.save(testRestaurant());
    const branchMenu = Menu.create({
      id: '10000000-0000-4000-8000-000000000003',
      restaurantId: RESTAURANT_ID,
      branchId: 'bbbbbbbb-0001-4000-8000-000000000001',
      name: 'Branch',
      isDefault: true,
      now: FIXED_NOW,
    });
    const shared = Menu.create({
      id: '10000000-0000-4000-8000-000000000004',
      restaurantId: RESTAURANT_ID,
      name: 'Shared',
      isDefault: false,
      now: FIXED_NOW,
    });
    await menuRepository.create(branchMenu);
    await menuRepository.create(shared);

    await useCase.execute({
      actor: ownerActor(),
      restaurantId: RESTAURANT_ID,
      menuId: shared.menuId.value,
    });

    const reloadedBranchMenu = await menuRepository.findByIdAndRestaurantId(
      branchMenu.menuId,
      RestaurantId.create(RESTAURANT_ID),
    );
    expect(reloadedBranchMenu?.isDefault).toBe(true);
    expect(priceLevelScheduler.requests).toBe(1);
  });

  it('404s for an unknown Menu', async () => {
    const { useCase, restaurantRepository } = build();
    await restaurantRepository.save(testRestaurant());

    await expect(
      useCase.execute({
        actor: ownerActor(),
        restaurantId: RESTAURANT_ID,
        menuId: MenuId.create('10000000-0000-4000-8000-000000000099').value,
      }),
    ).rejects.toBeInstanceOf(MenuNotFoundException);
  });
});
