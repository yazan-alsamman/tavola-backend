import { GetFloorPlanAreaUseCase } from './get-floor-plan-area.use-case';
import { FloorPlanAreaNotFoundException } from '../../domain/exceptions/floor-plan-area-not-found.exception';
import { FloorPlanNotFoundException } from '../../domain/exceptions/floor-plan-not-found.exception';
import {
  areaWorldActor,
  buildFloorPlanAreaWorld,
  seedArea,
  AREA_WORLD_IDS,
  AREA_WORLD_NOW,
} from '../../../../../test/tables/support/floor-plan-area-world';

describe('GetFloorPlanAreaUseCase (ADR-040)', () => {
  async function build() {
    const world = await buildFloorPlanAreaWorld();
    const useCase = new GetFloorPlanAreaUseCase(
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
    floorPlanAreaId: AREA_WORLD_IDS.areaId,
  };

  it('returns the area', async () => {
    const { useCase, world } = await build();
    await seedArea(world, { name: 'للضيوف', color: '#14B8A6', sortOrder: 3 });

    const result = await useCase.execute(validCommand);

    expect(result).toMatchObject({
      floorPlanAreaId: AREA_WORLD_IDS.areaId,
      floorPlanId: AREA_WORLD_IDS.floorPlanId,
      name: 'للضيوف',
      color: '#14B8A6',
      sortOrder: 3,
    });
  });

  it('throws FloorPlanAreaNotFoundException for an unknown area', async () => {
    const { useCase } = await build();

    await expect(useCase.execute(validCommand)).rejects.toBeInstanceOf(
      FloorPlanAreaNotFoundException,
    );
  });

  it('collapses an area of another floor plan to the same not-found response (IDOR-safe)', async () => {
    const { useCase, world } = await build();
    await seedArea(world, { floorPlanId: AREA_WORLD_IDS.otherFloorPlanId });

    await expect(useCase.execute(validCommand)).rejects.toBeInstanceOf(
      FloorPlanAreaNotFoundException,
    );
  });

  it('collapses a soft-deleted area to the same not-found response', async () => {
    const { useCase, world } = await build();
    await seedArea(world, { deletedAt: AREA_WORLD_NOW });

    await expect(useCase.execute(validCommand)).rejects.toBeInstanceOf(
      FloorPlanAreaNotFoundException,
    );
  });

  it('fails on the floor plan before the area id is ever considered', async () => {
    const { useCase, world } = await build();
    await seedArea(world);

    await expect(
      useCase.execute({ ...validCommand, floorPlanId: '99999999-9999-4999-8999-999999999999' }),
    ).rejects.toBeInstanceOf(FloorPlanNotFoundException);
  });
});
