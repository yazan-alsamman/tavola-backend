import { ReplaceMenuItemAvailabilityWindowsUseCase } from './replace-menu-item-availability-windows.use-case';
import { MenuItem } from '../../domain/entities/menu-item.entity';
import { MenuItemAvailabilityMode, MenuItemDietaryLabel } from '../../domain/enums/menu-item.enums';
import { InvalidMenuItemAvailabilityException } from '../../domain/exceptions/invalid-menu-item-availability.exception';
import { MenuItemAvailabilityWindowsReplacedEvent } from '../../domain/events/menu.events';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryMenuItemRepository } from '../../../../../test/menus/support/in-memory-menu-item.repository';
import { InMemoryMenuItemAvailabilityRepository } from '../../../../../test/menus/support/in-memory-menu-item-availability.repository';
import {
  FIXED_NOW,
  RESTAURANT_ID,
  testRestaurant,
  ownerActor,
} from '../../../../../test/menus/support/menu-test-fixtures';

const CATEGORY_ID = '88888888-8888-4888-8888-888888888888';

describe('ReplaceMenuItemAvailabilityWindowsUseCase (ADR-032)', () => {
  function build() {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const itemRepository = new InMemoryMenuItemRepository();
    const availabilityRepository = new InMemoryMenuItemAvailabilityRepository();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new ReplaceMenuItemAvailabilityWindowsUseCase(
      restaurantRepository,
      itemRepository,
      availabilityRepository,
      new FixedClock(FIXED_NOW),
      new SequentialIdGenerator([
        'aaaaaaaa-0001-4000-8000-000000000001',
        'aaaaaaaa-0001-4000-8000-000000000002',
        'aaaaaaaa-0001-4000-8000-000000000003',
      ]),
      eventPublisher,
      new ImmediateUnitOfWork(),
    );
    return {
      useCase,
      restaurantRepository,
      itemRepository,
      availabilityRepository,
      eventPublisher,
    };
  }

  function makeItem(mode: MenuItemAvailabilityMode) {
    const item = MenuItem.create({
      id: '99999999-9999-4999-8999-999999999999',
      categoryId: CATEGORY_ID,
      restaurantId: RESTAURANT_ID,
      content: {
        name: 'Pizza',
        description: null,
        price: 10,
        currency: null,
        preparationTimeMinutes: null,
        spicyLevel: null,
        calories: null,
        allergens: [],
        dietaryLabels: [] as MenuItemDietaryLabel[],
      },
      displayOrder: 0,
      now: FIXED_NOW,
    });
    return item.changeAvailabilityMode(mode, FIXED_NOW);
  }

  it('rejects replacing windows when availabilityMode is not Scheduled', async () => {
    const { useCase, restaurantRepository, itemRepository } = build();
    await restaurantRepository.save(testRestaurant());
    const item = makeItem(MenuItemAvailabilityMode.Always);
    await itemRepository.create(item);

    await expect(
      useCase.execute({
        actor: ownerActor(),
        restaurantId: RESTAURANT_ID,
        menuId: '10000000-0000-4000-8000-000000000001',
        categoryId: CATEGORY_ID,
        itemId: item.menuItemId.value,
        windows: [{ dayOfWeek: 1, startTime: '08:00', endTime: '11:00' }],
      }),
    ).rejects.toBeInstanceOf(InvalidMenuItemAvailabilityException);
  });

  it('replaces the whole window set when Scheduled and publishes MenuItemAvailabilityWindowsReplaced', async () => {
    const {
      useCase,
      restaurantRepository,
      itemRepository,
      availabilityRepository,
      eventPublisher,
    } = build();
    await restaurantRepository.save(testRestaurant());
    const item = makeItem(MenuItemAvailabilityMode.Scheduled);
    await itemRepository.create(item);

    await useCase.execute({
      actor: ownerActor(),
      restaurantId: RESTAURANT_ID,
      menuId: '10000000-0000-4000-8000-000000000001',
      categoryId: CATEGORY_ID,
      itemId: item.menuItemId.value,
      windows: [
        { dayOfWeek: 1, startTime: '08:00', endTime: '11:00' },
        { dayOfWeek: 1, startTime: '18:00', endTime: '22:00' },
      ],
    });

    const stored = await availabilityRepository.findManyByMenuItemId(item.menuItemId);
    expect(stored).toHaveLength(2);
    expect(eventPublisher.events[0]).toBeInstanceOf(MenuItemAvailabilityWindowsReplacedEvent);
    const event = eventPublisher.events[0] as MenuItemAvailabilityWindowsReplacedEvent;
    expect(event.payload.windowCount).toBe(2);
  });

  it('an empty windows array clears all existing windows', async () => {
    const { useCase, restaurantRepository, itemRepository, availabilityRepository } = build();
    await restaurantRepository.save(testRestaurant());
    const item = makeItem(MenuItemAvailabilityMode.Scheduled);
    await itemRepository.create(item);

    await useCase.execute({
      actor: ownerActor(),
      restaurantId: RESTAURANT_ID,
      menuId: '10000000-0000-4000-8000-000000000001',
      categoryId: CATEGORY_ID,
      itemId: item.menuItemId.value,
      windows: [{ dayOfWeek: 1, startTime: '08:00', endTime: '11:00' }],
    });
    await useCase.execute({
      actor: ownerActor(),
      restaurantId: RESTAURANT_ID,
      menuId: '10000000-0000-4000-8000-000000000001',
      categoryId: CATEGORY_ID,
      itemId: item.menuItemId.value,
      windows: [],
    });

    const stored = await availabilityRepository.findManyByMenuItemId(item.menuItemId);
    expect(stored).toHaveLength(0);
  });
});
