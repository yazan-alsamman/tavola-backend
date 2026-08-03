import { CreateMenuUseCase } from './create-menu.use-case';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { MenuCreatedEvent } from '../../domain/events/menu.events';
import {
  CollectingEventPublisher,
  CollectingAuditLogWriter,
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
  employeeActor,
} from '../../../../../test/menus/support/menu-test-fixtures';

describe('CreateMenuUseCase', () => {
  function build() {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const menuRepository = new InMemoryMenuRepository();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new CreateMenuUseCase(
      restaurantRepository,
      menuRepository,
      new FixedClock(FIXED_NOW),
      new SequentialIdGenerator([
        'aaaaaaaa-0001-4000-8000-000000000001',
        'aaaaaaaa-0001-4000-8000-000000000002',
        'aaaaaaaa-0001-4000-8000-000000000003',
        'aaaaaaaa-0001-4000-8000-000000000004',
      ]),
      eventPublisher,
      new ImmediateUnitOfWork(),
      new CollectingAuditLogWriter(),
    );
    return { useCase, restaurantRepository, menuRepository, eventPublisher };
  }

  it('auto-marks the first Menu created for a Restaurant as isDefault', async () => {
    const { useCase, restaurantRepository, eventPublisher } = build();
    await restaurantRepository.save(testRestaurant());

    const result = await useCase.execute({
      actor: ownerActor(),
      restaurantId: RESTAURANT_ID,
      name: 'Main',
    });

    expect(result.isDefault).toBe(true);
    expect(eventPublisher.events[0]).toBeInstanceOf(MenuCreatedEvent);
  });

  it('does not mark a second Menu as default', async () => {
    const { useCase, restaurantRepository } = build();
    await restaurantRepository.save(testRestaurant());

    await useCase.execute({ actor: ownerActor(), restaurantId: RESTAURANT_ID, name: 'Breakfast' });
    const second = await useCase.execute({
      actor: ownerActor(),
      restaurantId: RESTAURANT_ID,
      name: 'Dinner',
    });

    expect(second.isDefault).toBe(false);
  });

  it('404s when the restaurant does not exist (or belongs to another organization)', async () => {
    const { useCase } = build();
    await expect(
      useCase.execute({ actor: ownerActor(), restaurantId: RESTAURANT_ID, name: 'Main' }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });

  it('denies an Employee missing menu:manage', async () => {
    const { useCase, restaurantRepository } = build();
    await restaurantRepository.save(testRestaurant());

    await expect(
      useCase.execute({
        actor: employeeActor({ permissions: [] }),
        restaurantId: RESTAURANT_ID,
        name: 'Main',
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedException);
  });

  it('allows an Employee holding menu:manage', async () => {
    const { useCase, restaurantRepository } = build();
    await restaurantRepository.save(testRestaurant());

    const result = await useCase.execute({
      actor: employeeActor({ permissions: ['menu:manage'] }),
      restaurantId: RESTAURANT_ID,
      name: 'Main',
    });
    expect(result.name).toBe('Main');
  });
});
