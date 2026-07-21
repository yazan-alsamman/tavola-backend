import { UpdateTableUseCase } from './update-table.use-case';
import { CreateTableUseCase } from './create-table.use-case';
import { TableNotFoundException } from '../../domain/exceptions/table-not-found.exception';
import { TableNumberAlreadyExistsException } from '../../domain/exceptions/table-number-already-exists.exception';
import { TableUpdatedEvent } from '../../domain/events/table.events';
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
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryBranchRepository } from '../../../../../test/branches/support/in-memory-branch.repository';
import { InMemoryFloorPlanRepository } from '../../../../../test/tables/support/in-memory-floor-plan.repository';
import { InMemoryTableRepository } from '../../../../../test/tables/support/in-memory-table.repository';

describe('UpdateTableUseCase', () => {
  const fixedNow = new Date('2026-07-17T12:00:00.000Z');
  const organizationId = '33333333-3333-4333-8333-333333333333';
  const restaurantId = '44444444-4444-4444-8444-444444444444';
  const branchId = '55555555-5555-4555-8555-555555555555';
  const floorPlanId = '66666666-6666-4666-8666-666666666666';
  const table1Id = '11111111-1111-4111-8111-111111111111';
  const table2Id = '77777777-7777-4777-8777-777777777777';

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
        table1Id,
        '88888888-8888-4888-8888-888888888888',
        table2Id,
        '99999999-9999-4999-8999-999999999998',
      ]),
      new CollectingEventPublisher(),
    );
    await createUseCase.execute({
      actor: baseActor(),
      restaurantId,
      branchId,
      floorPlanId,
      tableNumber: 'T1',
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
    await createUseCase.execute({
      actor: baseActor(),
      restaurantId,
      branchId,
      floorPlanId,
      tableNumber: 'T2',
      capacity: 2,
      floor: 1,
      positionX: null,
      positionY: null,
      width: null,
      height: null,
      rotation: null,
      shape: TableShape.Round,
      layer: null,
      indoor: true,
      vip: false,
      smoking: false,
    });

    const eventPublisher = new CollectingEventPublisher();
    const useCase = new UpdateTableUseCase(
      tableRepository,
      branchRepository,
      restaurantRepository,
      new FixedClock(fixedNow),
      new SequentialIdGenerator([
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      ]),
      eventPublisher,
    );
    return { useCase, tableRepository, eventPublisher };
  }

  const baseUpdate = {
    actor: baseActor(),
    tableId: table1Id,
    tableNumber: 'T1',
    capacity: 6,
    floor: 2,
    positionX: 5,
    positionY: 5,
    width: 50,
    height: 50,
    rotation: 90,
    shape: TableShape.Round,
    layer: 1,
    indoor: false,
    vip: true,
    smoking: true,
  };

  it('full-replaces profile fields but never status', async () => {
    const { useCase } = await build();

    const result = await useCase.execute(baseUpdate);

    expect(result.capacity).toBe(6);
    expect(result.shape).toBe(TableShape.Round);
    expect(result.vip).toBe(true);
    expect(result.status).toBe(TableStatus.Available);
  });

  it('allows renaming to a tableNumber not used by another table in the branch', async () => {
    const { useCase } = await build();

    const result = await useCase.execute({
      ...baseUpdate,
      tableId: table1Id,
      tableNumber: 'T1-renamed',
    });

    expect(result.tableNumber).toBe('T1-renamed');
  });

  it('throws TableNumberAlreadyExistsException when renaming to a number already used by another table', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({ ...baseUpdate, tableId: table1Id, tableNumber: 'T2' }),
    ).rejects.toBeInstanceOf(TableNumberAlreadyExistsException);
  });

  it('throws TableNotFoundException for an unknown table', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({ ...baseUpdate, tableId: '99999999-9999-4999-8999-999999999999' }),
    ).rejects.toBeInstanceOf(TableNotFoundException);
  });

  it('publishes exactly one TableUpdatedEvent', async () => {
    const { useCase, eventPublisher } = await build();

    await useCase.execute({ ...baseUpdate, correlationId: 'corr-1' });

    expect(eventPublisher.events).toHaveLength(1);
    expect(eventPublisher.events[0]).toBeInstanceOf(TableUpdatedEvent);
  });
});
