import { MoveTableUseCase } from './move-table.use-case';
import { CreateTableUseCase } from './create-table.use-case';
import { TableNotFoundException } from '../../domain/exceptions/table-not-found.exception';
import { FloorPlanNotFoundException } from '../../domain/exceptions/floor-plan-not-found.exception';
import { TableMergedOperationForbiddenException } from '../../domain/exceptions/table-merged-operation-forbidden.exception';
import { TableMovedEvent } from '../../domain/events/table.events';
import { TableId } from '@shared/domain/value-objects/identifiers.vo';
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
  UuidGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryBranchRepository } from '../../../../../test/branches/support/in-memory-branch.repository';
import { InMemoryFloorPlanRepository } from '../../../../../test/tables/support/in-memory-floor-plan.repository';
import { InMemoryTableRepository } from '../../../../../test/tables/support/in-memory-table.repository';

describe('MoveTableUseCase', () => {
  const fixedNow = new Date('2026-07-17T12:00:00.000Z');
  const organizationId = '33333333-3333-4333-8333-333333333333';
  const restaurantId = '44444444-4444-4444-8444-444444444444';
  const branchId = '55555555-5555-4555-8555-555555555555';
  const otherBranchId = '99999999-9999-4999-8999-999999999997';
  const mainFloorId = '66666666-6666-4666-8666-666666666666';
  const patioId = '77777777-7777-4777-8777-777777777777';
  const otherBranchFloorId = '99999999-9999-4999-8999-999999999996';
  const tableId = '11111111-1111-4111-8111-111111111111';

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
    await branchRepository.save(
      Branch.create({
        id: otherBranchId,
        restaurantId,
        city: 'Aleppo',
        district: null,
        address: '456 Other St',
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
        id: mainFloorId,
        branchId,
        name: 'Main Floor',
        isActive: true,
        createdAt: fixedNow,
        updatedAt: fixedNow,
        deletedAt: null,
      }),
    );
    await floorPlanRepository.save(
      FloorPlan.create({
        id: patioId,
        branchId,
        name: 'Patio',
        isActive: false,
        createdAt: fixedNow,
        updatedAt: fixedNow,
        deletedAt: null,
      }),
    );
    await floorPlanRepository.save(
      FloorPlan.create({
        id: otherBranchFloorId,
        branchId: otherBranchId,
        name: 'Other Branch Floor',
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
      new SequentialIdGenerator([tableId, '88888888-8888-4888-8888-888888888888']),
      new CollectingEventPublisher(),
    );
    await createUseCase.execute({
      actor: baseActor(),
      restaurantId,
      branchId,
      floorPlanId: mainFloorId,
      tableNumber: 'T1',
      capacity: 4,
      floor: 1,
      positionX: 10,
      positionY: 10,
      width: null,
      height: null,
      rotation: null,
      shape: TableShape.Rectangle,
      layer: null,
      indoor: true,
      vip: false,
      smoking: false,
    });

    const eventPublisher = new CollectingEventPublisher();
    const useCase = new MoveTableUseCase(
      tableRepository,
      floorPlanRepository,
      branchRepository,
      restaurantRepository,
      new FixedClock(fixedNow),
      new UuidGenerator(),
      eventPublisher,
    );
    return { useCase, tableRepository, eventPublisher };
  }

  it('moves a table to another floor plan of the same branch, changing only floorPlanId', async () => {
    const { useCase } = await build();

    const result = await useCase.execute({
      actor: baseActor(),
      tableId,
      targetFloorPlanId: patioId,
    });

    expect(result.floorPlanId).toBe(patioId);
    // Everything else is untouched.
    expect(result.tableNumber).toBe('T1');
    expect(result.capacity).toBe(4);
    expect(result.positionX).toBe(10);
    expect(result.positionY).toBe(10);
    expect(result.shape).toBe(TableShape.Rectangle);
    expect(result.status).toBe('Available');
  });

  it('throws TableNotFoundException for an unknown table', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: baseActor(),
        tableId: '99999999-9999-4999-8999-999999999999',
        targetFloorPlanId: patioId,
      }),
    ).rejects.toBeInstanceOf(TableNotFoundException);
  });

  it('throws FloorPlanNotFoundException for an unknown target floor plan', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: baseActor(),
        tableId,
        targetFloorPlanId: '99999999-9999-4999-8999-999999999995',
      }),
    ).rejects.toBeInstanceOf(FloorPlanNotFoundException);
  });

  it('throws FloorPlanNotFoundException when the target floor plan belongs to a different branch (cross-branch move rejected)', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: baseActor(),
        tableId,
        targetFloorPlanId: otherBranchFloorId,
      }),
    ).rejects.toBeInstanceOf(FloorPlanNotFoundException);
  });

  it('throws FloorPlanNotFoundException when the target floor plan is soft-deleted', async () => {
    const branchRepository = new InMemoryBranchRepository();
    const restaurantRepository = new InMemoryRestaurantRepository();
    const isolatedFloorPlanRepository = new InMemoryFloorPlanRepository();
    const isolatedTableRepository = new InMemoryTableRepository();

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
    const deletedFloorPlan = FloorPlan.create({
      id: patioId,
      branchId,
      name: 'Patio',
      isActive: false,
      createdAt: fixedNow,
      updatedAt: fixedNow,
      deletedAt: null,
    });
    await isolatedFloorPlanRepository.save(
      FloorPlan.reconstitute({ ...deletedFloorPlan.toProps(), deletedAt: fixedNow }),
    );
    await isolatedFloorPlanRepository.save(
      FloorPlan.create({
        id: mainFloorId,
        branchId,
        name: 'Main Floor',
        isActive: true,
        createdAt: fixedNow,
        updatedAt: fixedNow,
        deletedAt: null,
      }),
    );
    const createUseCase = new CreateTableUseCase(
      isolatedTableRepository,
      isolatedFloorPlanRepository,
      branchRepository,
      restaurantRepository,
      new FixedClock(fixedNow),
      new SequentialIdGenerator([tableId, '88888888-8888-4888-8888-888888888888']),
      new CollectingEventPublisher(),
    );
    await createUseCase.execute({
      actor: baseActor(),
      restaurantId,
      branchId,
      floorPlanId: mainFloorId,
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
    });

    const isolatedUseCase = new MoveTableUseCase(
      isolatedTableRepository,
      isolatedFloorPlanRepository,
      branchRepository,
      restaurantRepository,
      new FixedClock(fixedNow),
      new UuidGenerator(),
      new CollectingEventPublisher(),
    );

    await expect(
      isolatedUseCase.execute({ actor: baseActor(), tableId, targetFloorPlanId: patioId }),
    ).rejects.toBeInstanceOf(FloorPlanNotFoundException);
  });

  it('throws TableMergedOperationForbiddenException for a table currently part of an active merge group (ADR-026 decision #11/#13), leaving it untouched', async () => {
    const { useCase, tableRepository } = await build();

    const existing = await tableRepository.findById(TableId.create(tableId));
    const merged = existing!.asMergePrimary('88888888-8888-4888-8888-888888888888', fixedNow);
    await tableRepository.save(merged);

    await expect(
      useCase.execute({ actor: baseActor(), tableId, targetFloorPlanId: patioId }),
    ).rejects.toBeInstanceOf(TableMergedOperationForbiddenException);

    // Rejected BEFORE the target floor plan lookup - even an unknown target
    // is rejected the same way, and the table is never touched either way.
    await expect(
      useCase.execute({
        actor: baseActor(),
        tableId,
        targetFloorPlanId: '99999999-9999-4999-8999-999999999995',
      }),
    ).rejects.toBeInstanceOf(TableMergedOperationForbiddenException);

    const stillMerged = await tableRepository.findById(TableId.create(tableId));
    expect(stillMerged?.floorPlanId.value).toBe(mainFloorId);
    expect(stillMerged?.mergeGroupId).toBe('88888888-8888-4888-8888-888888888888');
  });

  it('publishes a TableMovedEvent with the frozen Phase 8 payload shape', async () => {
    const { useCase, eventPublisher } = await build();

    await useCase.execute({
      actor: baseActor(),
      tableId,
      targetFloorPlanId: patioId,
      correlationId: 'corr-1',
    });

    expect(eventPublisher.events).toHaveLength(1);
    const event = eventPublisher.events[0] as TableMovedEvent;
    expect(event).toBeInstanceOf(TableMovedEvent);
    expect(event.eventName).toBe('TableMoved');
    expect(event.correlationId).toBe('corr-1');
    expect(event.payload).toMatchObject({
      tableId,
      branchId,
      organizationId,
      oldFloorPlanId: mainFloorId,
      newFloorPlanId: patioId,
      actorId: 'user-1',
    });
  });
});
