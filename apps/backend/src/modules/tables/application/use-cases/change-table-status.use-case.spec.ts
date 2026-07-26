import { ChangeTableStatusUseCase } from './change-table-status.use-case';
import { CreateTableUseCase } from './create-table.use-case';
import { TableNotFoundException } from '../../domain/exceptions/table-not-found.exception';
import { InvalidTableStatusTransitionException } from '../../domain/exceptions/invalid-table-status-transition.exception';
import { TableMergedOperationForbiddenException } from '../../domain/exceptions/table-merged-operation-forbidden.exception';
import { TableStatusChangedEvent } from '../../domain/events/table.events';
import { TableId } from '@shared/domain/value-objects/identifiers.vo';
import { TableShape, TableStatus } from '../../domain/enums/table.enums';
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

describe('ChangeTableStatusUseCase', () => {
  const fixedNow = new Date('2026-07-17T12:00:00.000Z');
  const organizationId = '33333333-3333-4333-8333-333333333333';
  const restaurantId = '44444444-4444-4444-8444-444444444444';
  const branchId = '55555555-5555-4555-8555-555555555555';
  const floorPlanId = '66666666-6666-4666-8666-666666666666';
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
      new SequentialIdGenerator([tableId, '88888888-8888-4888-8888-888888888888']),
      new CollectingEventPublisher(),
    );
    await createUseCase.execute({
      actor: baseActor(),
      restaurantId,
      branchId,
      floorPlanId,
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

    const eventPublisher = new CollectingEventPublisher();
    const useCase = new ChangeTableStatusUseCase(
      tableRepository,
      branchRepository,
      restaurantRepository,
      new FixedClock(fixedNow),
      new UuidGenerator(),
      eventPublisher,
    );
    return { useCase, tableRepository, eventPublisher };
  }

  it('transitions Available -> Occupied', async () => {
    const { useCase } = await build();

    const result = await useCase.execute({
      actor: baseActor(),
      tableId,
      status: TableStatus.Occupied,
    });

    expect(result.status).toBe(TableStatus.Occupied);
  });

  it('transitions Available -> Cleaning', async () => {
    const { useCase } = await build();

    const result = await useCase.execute({
      actor: baseActor(),
      tableId,
      status: TableStatus.Cleaning,
    });

    expect(result.status).toBe(TableStatus.Cleaning);
  });

  it('transitions Available -> Disabled', async () => {
    const { useCase } = await build();

    const result = await useCase.execute({
      actor: baseActor(),
      tableId,
      status: TableStatus.Disabled,
    });

    expect(result.status).toBe(TableStatus.Disabled);
  });

  it('transitions back to Available from Occupied/Cleaning/Disabled', async () => {
    const { useCase } = await build();

    await useCase.execute({ actor: baseActor(), tableId, status: TableStatus.Occupied });
    const backToAvailable = await useCase.execute({
      actor: baseActor(),
      tableId,
      status: TableStatus.Available,
    });

    expect(backToAvailable.status).toBe(TableStatus.Available);
  });

  it.each([
    [TableStatus.Occupied, TableStatus.Cleaning],
    [TableStatus.Occupied, TableStatus.Disabled],
    [TableStatus.Cleaning, TableStatus.Occupied],
    [TableStatus.Cleaning, TableStatus.Disabled],
    [TableStatus.Disabled, TableStatus.Occupied],
    [TableStatus.Disabled, TableStatus.Cleaning],
  ])(
    'rejects the forbidden direct transition %s -> %s',
    async (from: TableStatus, to: TableStatus) => {
      const { useCase } = await build();
      await useCase.execute({ actor: baseActor(), tableId, status: from });

      await expect(
        useCase.execute({ actor: baseActor(), tableId, status: to }),
      ).rejects.toBeInstanceOf(InvalidTableStatusTransitionException);
    },
  );

  it('rejects a same-status "transition" (no implicit transitions)', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({ actor: baseActor(), tableId, status: TableStatus.Available }),
    ).rejects.toBeInstanceOf(InvalidTableStatusTransitionException);
  });

  it('throws TableMergedOperationForbiddenException for a table currently part of an active merge group (ADR-026 decision #11/#13), leaving it untouched', async () => {
    const { useCase, tableRepository } = await build();

    const existing = await tableRepository.findById(TableId.create(tableId));
    const merged = existing!.asMergePrimary('88888888-8888-4888-8888-888888888888', fixedNow);
    await tableRepository.save(merged);

    await expect(
      useCase.execute({ actor: baseActor(), tableId, status: TableStatus.Occupied }),
    ).rejects.toBeInstanceOf(TableMergedOperationForbiddenException);

    const stillMerged = await tableRepository.findById(TableId.create(tableId));
    expect(stillMerged?.status).toBe(TableStatus.Available);
    expect(stillMerged?.mergeGroupId).toBe('88888888-8888-4888-8888-888888888888');
  });

  it('throws TableNotFoundException for an unknown table', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: baseActor(),
        tableId: '99999999-9999-4999-8999-999999999999',
        status: TableStatus.Occupied,
      }),
    ).rejects.toBeInstanceOf(TableNotFoundException);
  });

  it('publishes a TableStatusChangedEvent with the frozen Phase 8 payload shape', async () => {
    const { useCase, eventPublisher } = await build();

    await useCase.execute({
      actor: baseActor(),
      tableId,
      status: TableStatus.Occupied,
      correlationId: 'corr-1',
    });

    expect(eventPublisher.events).toHaveLength(1);
    const event = eventPublisher.events[0] as TableStatusChangedEvent;
    expect(event).toBeInstanceOf(TableStatusChangedEvent);
    expect(event.eventName).toBe('TableStatusChanged');
    expect(event.correlationId).toBe('corr-1');
    expect(event.payload).toMatchObject({
      tableId,
      branchId,
      floorPlanId,
      organizationId,
      fromStatus: TableStatus.Available,
      toStatus: TableStatus.Occupied,
      actorId: 'user-1',
    });
  });
});
