import { CreateMenuUseCase } from './create-menu.use-case';
import { Branch } from '@modules/branches/domain/entities/branch.entity';
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
import { InMemoryBranchRepository } from '../../../../../test/branches/support/in-memory-branch.repository';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
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
    const branchRepository = new InMemoryBranchRepository();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new CreateMenuUseCase(
      restaurantRepository,
      menuRepository,
      branchRepository,
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
    return { useCase, restaurantRepository, menuRepository, branchRepository, eventPublisher };
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

  describe('branch menus (ADR-046)', () => {
    const BRANCH_ID = 'bbbbbbbb-0001-4000-8000-000000000001';

    function testBranch(restaurantId = RESTAURANT_ID) {
      return Branch.create({
        id: BRANCH_ID,
        restaurantId,
        city: 'Damascus',
        district: null,
        address: '1 Main St',
        latitude: null,
        longitude: null,
        countryCode: 'SY',
        currency: 'SYP',
        timezone: 'Asia/Damascus',
        phone: null,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
        deletedAt: null,
      });
    }

    it("makes a branch's first menu that branch's default, apart from the shared one", async () => {
      const { useCase, restaurantRepository, branchRepository } = build();
      await restaurantRepository.save(testRestaurant());
      await branchRepository.save(testBranch());

      const shared = await useCase.execute({
        actor: ownerActor(),
        restaurantId: RESTAURANT_ID,
        name: 'Shared',
      });
      const own = await useCase.execute({
        actor: ownerActor(),
        restaurantId: RESTAURANT_ID,
        name: 'Branch',
        branchId: BRANCH_ID,
      });

      expect(shared).toMatchObject({ branchId: null, isDefault: true });
      expect(own).toMatchObject({ branchId: BRANCH_ID, isDefault: true });
    });

    it('404s for a branch of another restaurant', async () => {
      const { useCase, restaurantRepository, branchRepository } = build();
      await restaurantRepository.save(testRestaurant());
      await branchRepository.save(testBranch('cccccccc-0001-4000-8000-000000000001'));

      await expect(
        useCase.execute({
          actor: ownerActor(),
          restaurantId: RESTAURANT_ID,
          name: 'Branch',
          branchId: BRANCH_ID,
        }),
      ).rejects.toBeInstanceOf(BranchNotFoundException);
    });
  });
});
