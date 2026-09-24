import { ListFloorPlanAreasUseCase } from './list-floor-plan-areas.use-case';
import { FloorPlanNotFoundException } from '../../domain/exceptions/floor-plan-not-found.exception';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { FloorPlanArea } from '../../domain/entities/floor-plan-area.entity';
import {
  areaWorldActor,
  buildFloorPlanAreaWorld,
  seedArea,
  AREA_WORLD_IDS,
  AREA_WORLD_NOW,
} from '../../../../../test/tables/support/floor-plan-area-world';

describe('ListFloorPlanAreasUseCase (ADR-040)', () => {
  async function build() {
    const world = await buildFloorPlanAreaWorld();
    const useCase = new ListFloorPlanAreasUseCase(
      world.floorPlanAreaRepository,
      world.floorPlanRepository,
      world.branchRepository,
      world.restaurantRepository,
    );
    return { useCase, world };
  }

  const validCommand = {
    actor: areaWorldActor(),
    restaurantId: AREA_WORLD_IDS.restaurantId,
    branchId: AREA_WORLD_IDS.branchId,
    floorPlanId: AREA_WORLD_IDS.floorPlanId,
  };

  it('returns an empty list for a plan with no areas - a valid, fully configured layout', async () => {
    const { useCase } = await build();

    await expect(useCase.execute(validCommand)).resolves.toEqual({ items: [] });
  });

  it('orders by sortOrder ascending, then createdAt ascending for ties', async () => {
    const { useCase, world } = await build();
    await seedArea(world, { id: AREA_WORLD_IDS.areaId, name: 'Guests', sortOrder: 2 });
    await seedArea(world, { id: AREA_WORLD_IDS.otherAreaId, name: 'Main Hall', sortOrder: 1 });
    await world.floorPlanAreaRepository.save(
      FloorPlanArea.reconstitute({
        id: '99999999-9999-4999-8999-999999999992',
        floorPlanId: AREA_WORLD_IDS.floorPlanId,
        name: 'Terrace',
        color: '#F97316',
        sortOrder: 1,
        createdAt: new Date(AREA_WORLD_NOW.getTime() + 1000),
        updatedAt: AREA_WORLD_NOW,
        deletedAt: null,
      }),
    );

    const result = await useCase.execute(validCommand);

    expect(result.items.map((item) => item.name)).toEqual(['Main Hall', 'Terrace', 'Guests']);
  });

  it('excludes soft-deleted areas', async () => {
    const { useCase, world } = await build();
    await seedArea(world, { id: AREA_WORLD_IDS.areaId, name: 'Main Hall' });
    await seedArea(world, {
      id: AREA_WORLD_IDS.otherAreaId,
      name: 'Removed',
      deletedAt: AREA_WORLD_NOW,
    });

    const result = await useCase.execute(validCommand);

    expect(result.items.map((item) => item.name)).toEqual(['Main Hall']);
  });

  it('never returns areas belonging to another floor plan of the same branch', async () => {
    const { useCase, world } = await build();
    await seedArea(world, { id: AREA_WORLD_IDS.areaId, name: 'Main Hall' });
    await seedArea(world, {
      id: AREA_WORLD_IDS.otherAreaId,
      name: 'Patio Hall',
      floorPlanId: AREA_WORLD_IDS.otherFloorPlanId,
    });

    const result = await useCase.execute(validCommand);

    expect(result.items.map((item) => item.name)).toEqual(['Main Hall']);
  });

  it('throws FloorPlanNotFoundException for a plan of another branch', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({ ...validCommand, floorPlanId: '99999999-9999-4999-8999-999999999999' }),
    ).rejects.toBeInstanceOf(FloorPlanNotFoundException);
  });

  it('throws RestaurantNotFoundException before reaching the area repository', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({ ...validCommand, restaurantId: '99999999-9999-4999-8999-999999999999' }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });
});
