import { ListTablesByBranchUseCase } from './list-tables-by-branch.use-case';
import { CreateTableUseCase } from './create-table.use-case';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import { TableShape } from '../../domain/enums/table.enums';
import { FloorPlan } from '../../domain/entities/floor-plan.entity';
import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import { RestaurantStatus } from '@modules/restaurants/domain/enums/restaurant.enums';
import { Branch } from '@modules/branches/domain/entities/branch.entity';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  CollectingEventPublisher,
  FixedClock,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryBranchRepository } from '../../../../../test/branches/support/in-memory-branch.repository';
import { InMemoryFloorPlanRepository } from '../../../../../test/tables/support/in-memory-floor-plan.repository';
import { InMemoryTableRepository } from '../../../../../test/tables/support/in-memory-table.repository';

describe('ListTablesByBranchUseCase', () => {
  const fixedNow = new Date('2026-07-17T12:00:00.000Z');
  const organizationId = '33333333-3333-4333-8333-333333333333';
  const restaurantId = '44444444-4444-4444-8444-444444444444';
  const branchId = '55555555-5555-4555-8555-555555555555';
  const floorPlanId = '66666666-6666-4666-8666-666666666666';

  function baseActor() {
    return {
      actorType: AccessTokenActorType.OrganizationMember as const,
      userId: 'user-1',
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
      organizationId,
      orgRole: 'Owner',
      permissionsVersion: 1,
    };
  }

  async function build() {
    const tableRepository = new InMemoryTableRepository();
    const floorPlanRepository = new InMemoryFloorPlanRepository();
    const branchRepository = new InMemoryBranchRepository();
    const restaurantRepository = new InMemoryRestaurantRepository();

    await restaurantRepository.save(
      Restaurant.create({
        id: restaurantId,
        organizationId,
        name: 'The Old Mill',
        slug: 'the-old-mill',
        logoId: null,
        coverImageId: null,
        description: null,
        cuisineType: null,
        averageRating: null,
        priceLevel: null,
        status: RestaurantStatus.Active,
        createdAt: fixedNow,
        updatedAt: fixedNow,
        deletedAt: null,
      }),
    );
    await branchRepository.save(
      Branch.create({
        id: branchId,
        restaurantId,
        city: 'Damascus',
        district: null,
        address: '123 Main St',
        latitude: null,
        longitude: null,
        countryCode: 'SY',
        currency: null,
        timezone: 'Asia/Damascus',
        phone: null,
        createdAt: fixedNow,
        updatedAt: fixedNow,
        deletedAt: null,
      }),
    );
    await floorPlanRepository.save(
      FloorPlan.create({
        id: floorPlanId,
        branchId,
        name: 'Main Floor',
        isActive: true,
        createdAt: fixedNow,
        updatedAt: fixedNow,
        deletedAt: null,
      }),
    );

    const createUseCase = new CreateTableUseCase(
      tableRepository,
      floorPlanRepository,
      branchRepository,
      restaurantRepository,
      new FixedClock(fixedNow),
      new SequentialIdGenerator([
        '11111111-1111-4111-8111-111111111111',
        '88888888-8888-4888-8888-888888888888',
        '77777777-7777-4777-8777-777777777777',
        '99999999-9999-4999-8999-999999999998',
      ]),
      new CollectingEventPublisher(),
    );
    for (const tableNumber of ['T1', 'T2']) {
      await createUseCase.execute({
        actor: baseActor(),
        restaurantId,
        branchId,
        floorPlanId,
        tableNumber,
        capacity: 4,
        floor: 1,
        positionX: null,
        positionY: null,
        width: null,
        height: null,
        rotation: null,
        shape: TableShape.Rectangle,
        layer: null,
        indoor: true,
        vip: false,
        smoking: false,
      });
    }

    const useCase = new ListTablesByBranchUseCase(
      tableRepository,
      branchRepository,
      restaurantRepository,
    );
    return { useCase };
  }

  it('lists tables belonging to the branch, paginated', async () => {
    const { useCase } = await build();

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      branchId,
      page: 1,
      limit: 20,
    });

    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
  });

  it('throws RestaurantNotFoundException when the restaurant does not exist', async () => {
    const useCase = new ListTablesByBranchUseCase(
      new InMemoryTableRepository(),
      new InMemoryBranchRepository(),
      new InMemoryRestaurantRepository(),
    );

    await expect(
      useCase.execute({ actor: baseActor(), restaurantId, branchId, page: 1, limit: 20 }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });

  it('throws BranchNotFoundException when the branch does not exist', async () => {
    const restaurantRepository = new InMemoryRestaurantRepository();
    await restaurantRepository.save(
      Restaurant.create({
        id: restaurantId,
        organizationId,
        name: 'The Old Mill',
        slug: 'the-old-mill',
        logoId: null,
        coverImageId: null,
        description: null,
        cuisineType: null,
        averageRating: null,
        priceLevel: null,
        status: RestaurantStatus.Active,
        createdAt: fixedNow,
        updatedAt: fixedNow,
        deletedAt: null,
      }),
    );
    const useCase = new ListTablesByBranchUseCase(
      new InMemoryTableRepository(),
      new InMemoryBranchRepository(),
      restaurantRepository,
    );

    await expect(
      useCase.execute({ actor: baseActor(), restaurantId, branchId, page: 1, limit: 20 }),
    ).rejects.toBeInstanceOf(BranchNotFoundException);
  });
});
