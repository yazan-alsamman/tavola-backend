import { CreateFloorPlanAreaUseCase } from './create-floor-plan-area.use-case';
import { FloorPlanAreaNameAlreadyExistsException } from '../../domain/exceptions/floor-plan-area-name-already-exists.exception';
import { FloorPlanNotFoundException } from '../../domain/exceptions/floor-plan-not-found.exception';
import { InvalidHexColorException } from '../../domain/exceptions/invalid-hex-color.exception';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import { BranchId, FloorPlanId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CollectingAuditLogWriter,
  FixedClock,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import {
  areaWorldActor,
  buildFloorPlanAreaWorld,
  seedArea,
  AREA_WORLD_IDS,
  AREA_WORLD_NOW,
} from '../../../../../test/tables/support/floor-plan-area-world';

describe('CreateFloorPlanAreaUseCase (ADR-040)', () => {
  const newAreaId = '99999999-9999-4999-8999-999999999991';

  async function build() {
    const world = await buildFloorPlanAreaWorld();
    const auditLogWriter = new CollectingAuditLogWriter();
    const useCase = new CreateFloorPlanAreaUseCase(
      world.floorPlanAreaRepository,
      world.floorPlanRepository,
      world.branchRepository,
      world.restaurantRepository,
      new FixedClock(AREA_WORLD_NOW),
      new SequentialIdGenerator([newAreaId]),
      auditLogWriter,
    );
    return { useCase, world, auditLogWriter };
  }

  const validCommand = {
    actor: areaWorldActor(),
    restaurantId: AREA_WORLD_IDS.restaurantId,
    branchId: AREA_WORLD_IDS.branchId,
    floorPlanId: AREA_WORLD_IDS.floorPlanId,
    name: 'Main Hall',
    color: '#14b8a6',
    sortOrder: 0,
  };

  it('creates an area under the floor plan, with the color normalized', async () => {
    const { useCase } = await build();

    const result = await useCase.execute(validCommand);

    expect(result.floorPlanAreaId).toBe(newAreaId);
    expect(result.floorPlanId).toBe(AREA_WORLD_IDS.floorPlanId);
    expect(result.name).toBe('Main Hall');
    expect(result.color).toBe('#14B8A6');
    expect(result.sortOrder).toBe(0);
  });

  it('allows several areas to exist concurrently - there is no active-area invariant', async () => {
    const { useCase, world } = await build();
    await seedArea(world, { name: 'Guests' });

    await useCase.execute(validCommand);

    const areas = await world.floorPlanAreaRepository.findManyByFloorPlanId(
      FloorPlanId.create(AREA_WORLD_IDS.floorPlanId),
    );
    expect(areas.map((a) => a.name).sort()).toEqual(['Guests', 'Main Hall']);
  });

  it('leaves the FloorPlan activation state of the branch completely untouched', async () => {
    const { useCase, world } = await build();

    await useCase.execute(validCommand);

    const plans = await world.floorPlanRepository.findManyByBranchId(
      BranchId.create(AREA_WORLD_IDS.branchId),
    );
    expect(plans.map((plan) => [plan.floorPlanId.value, plan.isActive] as const).sort()).toEqual(
      [
        [AREA_WORLD_IDS.floorPlanId, true],
        [AREA_WORLD_IDS.otherFloorPlanId, false],
      ].sort(),
    );
  });

  it('rejects a duplicate name within the same floor plan', async () => {
    const { useCase, world } = await build();
    await seedArea(world, { name: 'Main Hall' });

    await expect(useCase.execute(validCommand)).rejects.toBeInstanceOf(
      FloorPlanAreaNameAlreadyExistsException,
    );
  });

  it('compares the duplicate check against the trimmed name the entity would store', async () => {
    const { useCase, world } = await build();
    await seedArea(world, { name: 'Main Hall' });

    await expect(
      useCase.execute({ ...validCommand, name: '  Main Hall  ' }),
    ).rejects.toBeInstanceOf(FloorPlanAreaNameAlreadyExistsException);
  });

  it('allows the same name in a different floor plan of the same branch', async () => {
    const { useCase, world } = await build();
    await seedArea(world, { name: 'Main Hall', floorPlanId: AREA_WORLD_IDS.otherFloorPlanId });

    const result = await useCase.execute(validCommand);

    expect(result.name).toBe('Main Hall');
  });

  it('allows reusing the name of a soft-deleted area', async () => {
    const { useCase, world } = await build();
    await seedArea(world, { name: 'Main Hall', deletedAt: AREA_WORLD_NOW });

    const result = await useCase.execute(validCommand);

    expect(result.name).toBe('Main Hall');
  });

  it('rejects a malformed color before anything is persisted', async () => {
    const { useCase, world } = await build();

    await expect(useCase.execute({ ...validCommand, color: 'teal' })).rejects.toBeInstanceOf(
      InvalidHexColorException,
    );
    await expect(
      world.floorPlanAreaRepository.findManyByFloorPlanId(
        FloorPlanId.create(AREA_WORLD_IDS.floorPlanId),
      ),
    ).resolves.toEqual([]);
  });

  it('throws RestaurantNotFoundException for an unknown restaurant', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({ ...validCommand, restaurantId: '99999999-9999-4999-8999-999999999999' }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });

  it('throws BranchNotFoundException for a branch of another restaurant', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({ ...validCommand, branchId: '99999999-9999-4999-8999-999999999999' }),
    ).rejects.toBeInstanceOf(BranchNotFoundException);
  });

  it('throws FloorPlanNotFoundException for a floor plan of another branch', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({ ...validCommand, floorPlanId: '99999999-9999-4999-8999-999999999999' }),
    ).rejects.toBeInstanceOf(FloorPlanNotFoundException);
  });

  it('writes a floor_plan_area.created audit entry (no domain event class exists)', async () => {
    const { useCase, auditLogWriter } = await build();

    await useCase.execute({ ...validCommand, correlationId: 'corr-1' });

    expect(auditLogWriter.entries).toHaveLength(1);
    expect(auditLogWriter.entries[0]).toMatchObject({
      action: 'floor_plan_area.created',
      targetType: 'FloorPlanArea',
      targetId: newAreaId,
      organizationId: AREA_WORLD_IDS.organizationId,
      correlationId: 'corr-1',
    });
  });
});
