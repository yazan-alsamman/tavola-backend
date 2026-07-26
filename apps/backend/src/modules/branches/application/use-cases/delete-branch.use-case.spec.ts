import { DeleteBranchUseCase } from './delete-branch.use-case';
import { CreateBranchUseCase } from './create-branch.use-case';
import { GetBranchUseCase } from './get-branch.use-case';
import { BranchDeletedEvent } from '../../domain/events/branch.events';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { BranchNotFoundException } from '../../domain/exceptions/branch-not-found.exception';
import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import { RestaurantStatus } from '@modules/restaurants/domain/enums/restaurant.enums';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryBranchRepository } from '../../../../../test/branches/support/in-memory-branch.repository';
import { InMemoryFloorPlanRepository } from '../../../../../test/tables/support/in-memory-floor-plan.repository';
import { InMemoryTableRepository } from '../../../../../test/tables/support/in-memory-table.repository';
import { FloorPlan } from '@modules/tables/domain/entities/floor-plan.entity';
import { Table } from '@modules/tables/domain/entities/table.entity';
import { TableShape, TableStatus } from '@modules/tables/domain/enums/table.enums';
import { BranchId } from '@shared/domain/value-objects/identifiers.vo';

describe('DeleteBranchUseCase', () => {
  const fixedNow = new Date('2026-07-16T12:00:00.000Z');
  const organizationId = '33333333-3333-4333-8333-333333333333';
  const restaurantId = '44444444-4444-4444-8444-444444444444';
  const otherRestaurantId = '55555555-5555-4555-8555-555555555555';

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

  async function seedRestaurant(
    restaurantRepository: InMemoryRestaurantRepository,
    id: string,
  ): Promise<void> {
    const restaurant = Restaurant.create({
      id,
      organizationId,
      name: 'The Old Mill',
      slug: `the-old-mill-${id}`,
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
    });
    await restaurantRepository.save(restaurant);
  }

  async function setup() {
    const branchRepository = new InMemoryBranchRepository();
    const restaurantRepository = new InMemoryRestaurantRepository();
    await seedRestaurant(restaurantRepository, restaurantId);
    await seedRestaurant(restaurantRepository, otherRestaurantId);

    const createUseCase = new CreateBranchUseCase(
      branchRepository,
      restaurantRepository,
      new FixedClock(fixedNow),
      new SequentialIdGenerator([
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ]),
      new CollectingEventPublisher(),
    );
    const created = await createUseCase.execute({
      actor: baseActor(),
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
    });

    const floorPlanRepository = new InMemoryFloorPlanRepository();
    const tableRepository = new InMemoryTableRepository();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new DeleteBranchUseCase(
      branchRepository,
      restaurantRepository,
      floorPlanRepository,
      tableRepository,
      new FixedClock(new Date('2026-07-17T09:00:00.000Z')),
      new SequentialIdGenerator(['44444444-4444-4444-8444-444444444445']),
      eventPublisher,
      new ImmediateUnitOfWork(),
    );
    const getUseCase = new GetBranchUseCase(branchRepository, restaurantRepository);
    return { useCase, getUseCase, eventPublisher, created, floorPlanRepository, tableRepository };
  }

  it('soft-deletes the branch so it is no longer retrievable', async () => {
    const { useCase, getUseCase, created } = await setup();

    await useCase.execute({ actor: baseActor(), restaurantId, branchId: created.branchId });

    await expect(
      getUseCase.execute({ actor: baseActor(), restaurantId, branchId: created.branchId }),
    ).rejects.toBeInstanceOf(BranchNotFoundException);
  });

  it('publishes exactly one BranchDeletedEvent', async () => {
    const { useCase, eventPublisher, created } = await setup();

    await useCase.execute({
      actor: baseActor(),
      restaurantId,
      branchId: created.branchId,
      correlationId: 'corr-3',
    });

    expect(eventPublisher.events).toHaveLength(1);
    const event = eventPublisher.events[0] as BranchDeletedEvent;
    expect(event).toBeInstanceOf(BranchDeletedEvent);
    expect(event.payload).toMatchObject({
      branchId: created.branchId,
      restaurantId,
      organizationId,
    });
  });

  it('is not idempotent: deleting an already-deleted branch throws BranchNotFoundException', async () => {
    const { useCase, created } = await setup();

    await useCase.execute({ actor: baseActor(), restaurantId, branchId: created.branchId });

    await expect(
      useCase.execute({ actor: baseActor(), restaurantId, branchId: created.branchId }),
    ).rejects.toBeInstanceOf(BranchNotFoundException);
  });

  it('throws BranchNotFoundException when deleting via a different restaurant (IDOR)', async () => {
    const { useCase, created } = await setup();

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId: otherRestaurantId,
        branchId: created.branchId,
      }),
    ).rejects.toBeInstanceOf(BranchNotFoundException);
  });

  it('cascades to soft-delete the branch’s FloorPlans and Tables (TASKS.md Phase 6.1 decisions #3/#6)', async () => {
    const { useCase, created, floorPlanRepository, tableRepository } = await setup();
    const branchId = BranchId.create(created.branchId);

    const floorPlan = FloorPlan.create({
      id: '77777777-7777-4777-8777-777777777777',
      branchId: created.branchId,
      name: 'Main Floor',
      isActive: true,
      createdAt: fixedNow,
      updatedAt: fixedNow,
      deletedAt: null,
    });
    await floorPlanRepository.save(floorPlan);

    const table = Table.create({
      id: '88888888-8888-4888-8888-888888888888',
      branchId: created.branchId,
      floorPlanId: floorPlan.floorPlanId.value,
      tableNumber: 'T1',
      capacity: 4,
      floor: null,
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
      status: TableStatus.Available,
      mergeGroupId: null,
      isMergePrimary: false,
      createdAt: fixedNow,
      updatedAt: fixedNow,
      deletedAt: null,
    });
    await tableRepository.save(table);

    await useCase.execute({ actor: baseActor(), restaurantId, branchId: created.branchId });

    expect(
      await floorPlanRepository.findByIdAndBranchId(floorPlan.floorPlanId, branchId),
    ).toBeNull();
    expect(await tableRepository.findByIdAndBranchId(table.tableId, branchId)).toBeNull();
  });

  it('throws RestaurantNotFoundException when the restaurant does not exist', async () => {
    const branchRepository = new InMemoryBranchRepository();
    const restaurantRepository = new InMemoryRestaurantRepository();
    const useCase = new DeleteBranchUseCase(
      branchRepository,
      restaurantRepository,
      new InMemoryFloorPlanRepository(),
      new InMemoryTableRepository(),
      new FixedClock(fixedNow),
      new SequentialIdGenerator(['55555555-5555-4555-8555-555555555556']),
      new CollectingEventPublisher(),
      new ImmediateUnitOfWork(),
    );

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId: '77777777-7777-4777-8777-777777777777',
        branchId: '66666666-6666-4666-8666-666666666666',
      }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });
});
