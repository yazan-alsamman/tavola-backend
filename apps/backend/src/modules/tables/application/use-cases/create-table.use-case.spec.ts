import { CreateTableUseCase } from './create-table.use-case';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import { FloorPlanNotFoundException } from '../../domain/exceptions/floor-plan-not-found.exception';
import { TableNumberAlreadyExistsException } from '../../domain/exceptions/table-number-already-exists.exception';
import { TableCreatedEvent } from '../../domain/events/table.events';
import { TableShape, TableStatus } from '../../domain/enums/table.enums';
import { FloorPlan } from '../../domain/entities/floor-plan.entity';
import { FloorPlanArea } from '../../domain/entities/floor-plan-area.entity';
import { FloorPlanAreaNotFoundException } from '../../domain/exceptions/floor-plan-area-not-found.exception';
import { InvalidHexColorException } from '../../domain/exceptions/invalid-hex-color.exception';
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
import { InMemoryFloorPlanAreaRepository } from '../../../../../test/tables/support/in-memory-floor-plan-area.repository';

describe('CreateTableUseCase', () => {
  const fixedNow = new Date('2026-07-17T12:00:00.000Z');
  const tableId = '11111111-1111-4111-8111-111111111111';
  const eventId = '22222222-2222-4222-8222-222222222222';
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

    const eventPublisher = new CollectingEventPublisher();
    const floorPlanAreaRepository = new InMemoryFloorPlanAreaRepository(tableRepository);
    const useCase = new CreateTableUseCase(
      tableRepository,
      floorPlanRepository,
      floorPlanAreaRepository,
      branchRepository,
      restaurantRepository,
      new FixedClock(fixedNow),
      new SequentialIdGenerator([tableId, eventId]),
      eventPublisher,
    );
    return {
      useCase,
      tableRepository,
      floorPlanRepository,
      floorPlanAreaRepository,
      eventPublisher,
    };
  }

  const validCommand = {
    actor: baseActor(),
    restaurantId,
    branchId,
    floorPlanId,
    floorPlanAreaId: null,
    tableNumber: 'T1',
    capacity: 4,
    floor: 1,
    positionX: 10,
    positionY: 20,
    width: 100,
    height: 100,
    rotation: 0,
    shape: TableShape.Rectangle,
    color: null,
    layer: 0,
    indoor: true,
    vip: false,
    smoking: false,
  };

  it('creates a table always with status Available, regardless of any status-like input', async () => {
    const { useCase } = await build();

    const result = await useCase.execute(validCommand);

    expect(result.tableId).toBe(tableId);
    expect(result.status).toBe(TableStatus.Available);
    expect(result.mergeGroupId).toBeNull();
    expect(result.floorPlanId).toBe(floorPlanId);
  });

  it('throws RestaurantNotFoundException when the restaurant does not exist', async () => {
    const tableRepository = new InMemoryTableRepository();
    const floorPlanRepository = new InMemoryFloorPlanRepository();
    const branchRepository = new InMemoryBranchRepository();
    const restaurantRepository = new InMemoryRestaurantRepository();
    const floorPlanAreaRepository = new InMemoryFloorPlanAreaRepository(tableRepository);
    const useCase = new CreateTableUseCase(
      tableRepository,
      floorPlanRepository,
      floorPlanAreaRepository,
      branchRepository,
      restaurantRepository,
      new FixedClock(fixedNow),
      new SequentialIdGenerator([tableId, eventId]),
      new CollectingEventPublisher(),
    );

    await expect(useCase.execute(validCommand)).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });

  it('throws BranchNotFoundException when the branch does not belong to the restaurant', async () => {
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
    const floorPlanAreaRepository = new InMemoryFloorPlanAreaRepository(tableRepository);
    const useCase = new CreateTableUseCase(
      tableRepository,
      floorPlanRepository,
      floorPlanAreaRepository,
      branchRepository,
      restaurantRepository,
      new FixedClock(fixedNow),
      new SequentialIdGenerator([tableId, eventId]),
      new CollectingEventPublisher(),
    );

    await expect(useCase.execute(validCommand)).rejects.toBeInstanceOf(BranchNotFoundException);
  });

  it('throws FloorPlanNotFoundException when the floor plan does not belong to the branch', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({ ...validCommand, floorPlanId: '99999999-9999-4999-8999-999999999999' }),
    ).rejects.toBeInstanceOf(FloorPlanNotFoundException);
  });

  it('throws TableNumberAlreadyExistsException for a duplicate tableNumber within the branch', async () => {
    const { useCase } = await build();
    await useCase.execute(validCommand);

    await expect(useCase.execute(validCommand)).rejects.toBeInstanceOf(
      TableNumberAlreadyExistsException,
    );
  });

  it('publishes exactly one TableCreatedEvent', async () => {
    const { useCase, eventPublisher } = await build();

    await useCase.execute({ ...validCommand, correlationId: 'corr-1' });

    expect(eventPublisher.events).toHaveLength(1);
    const event = eventPublisher.events[0] as TableCreatedEvent;
    expect(event).toBeInstanceOf(TableCreatedEvent);
    expect(event.payload).toMatchObject({
      tableId,
      branchId,
      floorPlanId,
      organizationId,
      actorId: 'user-1',
    });
  });

  // --- ADR-040: concurrent dining areas + per-table color --------------------

  describe('floorPlanAreaId / color (ADR-040)', () => {
    const areaId = '77777777-7777-4777-8777-777777777777';
    const otherFloorPlanId = '88888888-8888-4888-8888-888888888888';

    async function buildWithArea(areaFloorPlanId = floorPlanId) {
      const context = await build();
      await context.floorPlanRepository.save(
        FloorPlan.create({
          id: otherFloorPlanId,
          branchId,
          name: 'Patio',
          isActive: false,
          createdAt: fixedNow,
          updatedAt: fixedNow,
          deletedAt: null,
        }),
      );
      await context.floorPlanAreaRepository.save(
        FloorPlanArea.create({
          id: areaId,
          floorPlanId: areaFloorPlanId,
          name: 'Main Hall',
          color: '#14B8A6',
          sortOrder: 0,
          createdAt: fixedNow,
          updatedAt: fixedNow,
          deletedAt: null,
        }),
      );
      return context;
    }

    it('places the table in an area of its own floor plan', async () => {
      const { useCase } = await buildWithArea();

      const result = await useCase.execute({ ...validCommand, floorPlanAreaId: areaId });

      expect(result.floorPlanAreaId).toBe(areaId);
    });

    it('defaults to no area, which is a fully valid placement', async () => {
      const { useCase } = await build();

      const result = await useCase.execute(validCommand);

      expect(result.floorPlanAreaId).toBeNull();
    });

    it('rejects an area belonging to a DIFFERENT floor plan of the same branch', async () => {
      const { useCase } = await buildWithArea(otherFloorPlanId);

      await expect(
        useCase.execute({ ...validCommand, floorPlanAreaId: areaId }),
      ).rejects.toBeInstanceOf(FloorPlanAreaNotFoundException);
    });

    it('rejects an unknown area id', async () => {
      const { useCase } = await build();

      await expect(
        useCase.execute({
          ...validCommand,
          floorPlanAreaId: '99999999-9999-4999-8999-999999999999',
        }),
      ).rejects.toBeInstanceOf(FloorPlanAreaNotFoundException);
    });

    it('stores an explicit color normalized, and null as null (inherit)', async () => {
      const { useCase } = await build();

      const colored = await useCase.execute({ ...validCommand, color: '#f97316' });
      expect(colored.color).toBe('#F97316');

      const { useCase: second } = await build();
      const inherited = await second.execute(validCommand);
      expect(inherited.color).toBeNull();
    });

    it('rejects a malformed color', async () => {
      const { useCase } = await build();

      await expect(useCase.execute({ ...validCommand, color: 'orange' })).rejects.toBeInstanceOf(
        InvalidHexColorException,
      );
    });
  });
});
