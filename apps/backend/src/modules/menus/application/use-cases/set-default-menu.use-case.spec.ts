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
import {
  FIXED_NOW,
  RESTAURANT_ID,
  testRestaurant,
  ownerActor,
} from '../../../../../test/menus/support/menu-test-fixtures';

describe('SetDefaultMenuUseCase (ADR-032)', () => {
  function build() {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const menuRepository = new InMemoryMenuRepository();
    const useCase = new SetDefaultMenuUseCase(
      restaurantRepository,
      menuRepository,
      new FixedClock(FIXED_NOW),
      new SequentialIdGenerator(['aaaaaaaa-0001-4000-8000-000000000001']),
      new CollectingEventPublisher(),
      new ImmediateUnitOfWork(),
    );
    return { useCase, restaurantRepository, menuRepository };
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
