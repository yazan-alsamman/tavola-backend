import { DeleteMenuUseCase } from './delete-menu.use-case';
import { Menu } from '../../domain/entities/menu.entity';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { MenuNotFoundException } from '../../domain/exceptions/menu-not-found.exception';
import { MenuDeletedEvent } from '../../domain/events/menu.events';
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

describe('DeleteMenuUseCase (soft delete, ADR-010)', () => {
  function build() {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const menuRepository = new InMemoryMenuRepository();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new DeleteMenuUseCase(
      restaurantRepository,
      menuRepository,
      new FixedClock(FIXED_NOW),
      new SequentialIdGenerator(['aaaaaaaa-0001-4000-8000-000000000001']),
      eventPublisher,
      new ImmediateUnitOfWork(),
    );
    return { useCase, restaurantRepository, menuRepository, eventPublisher };
  }

  it('soft-deletes the Menu (deletedAt set, row never removed) and publishes MenuDeleted', async () => {
    const { useCase, restaurantRepository, menuRepository, eventPublisher } = build();
    await restaurantRepository.save(testRestaurant());
    const menu = Menu.create({
      id: '10000000-0000-4000-8000-000000000001',
      restaurantId: RESTAURANT_ID,
      isDefault: true,
      now: FIXED_NOW,
    });
    await menuRepository.create(menu);

    await useCase.execute({
      actor: ownerActor(),
      restaurantId: RESTAURANT_ID,
      menuId: menu.menuId.value,
    });

    const found = await menuRepository.findByIdAndRestaurantId(
      menu.menuId,
      RestaurantId.create(RESTAURANT_ID),
    );
    expect(found).toBeNull();
    expect(eventPublisher.events[0]).toBeInstanceOf(MenuDeletedEvent);
  });

  it('404s deleting an already-deleted Menu (not idempotent)', async () => {
    const { useCase, restaurantRepository, menuRepository } = build();
    await restaurantRepository.save(testRestaurant());
    const menu = Menu.create({
      id: '10000000-0000-4000-8000-000000000001',
      restaurantId: RESTAURANT_ID,
      isDefault: true,
      now: FIXED_NOW,
    });
    await menuRepository.create(menu);

    await useCase.execute({
      actor: ownerActor(),
      restaurantId: RESTAURANT_ID,
      menuId: menu.menuId.value,
    });

    await expect(
      useCase.execute({
        actor: ownerActor(),
        restaurantId: RESTAURANT_ID,
        menuId: menu.menuId.value,
      }),
    ).rejects.toBeInstanceOf(MenuNotFoundException);
  });
});
