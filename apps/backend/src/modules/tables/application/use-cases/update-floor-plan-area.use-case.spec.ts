import { UpdateFloorPlanAreaUseCase } from './update-floor-plan-area.use-case';
import { FloorPlanAreaNotFoundException } from '../../domain/exceptions/floor-plan-area-not-found.exception';
import { FloorPlanAreaNameAlreadyExistsException } from '../../domain/exceptions/floor-plan-area-name-already-exists.exception';
import { InvalidHexColorException } from '../../domain/exceptions/invalid-hex-color.exception';
import { FloorPlanAreaId, FloorPlanId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CollectingAuditLogWriter,
  FixedClock,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import {
  areaWorldActor,
  buildFloorPlanAreaWorld,
  seedArea,
  AREA_WORLD_IDS,
  AREA_WORLD_NOW,
} from '../../../../../test/tables/support/floor-plan-area-world';

describe('UpdateFloorPlanAreaUseCase (ADR-040)', () => {
  const updatedAt = new Date('2026-09-24T13:00:00.000Z');

  async function build() {
    const world = await buildFloorPlanAreaWorld();
    const auditLogWriter = new CollectingAuditLogWriter();
    const useCase = new UpdateFloorPlanAreaUseCase(
      world.floorPlanAreaRepository,
      world.floorPlanRepository,
      world.branchRepository,
      world.restaurantRepository,
      new FixedClock(updatedAt),
      auditLogWriter,
    );
    return { useCase, world, auditLogWriter };
  }

  const validCommand = {
    actor: areaWorldActor(),
    restaurantId: AREA_WORLD_IDS.restaurantId,
    branchId: AREA_WORLD_IDS.branchId,
    floorPlanId: AREA_WORLD_IDS.floorPlanId,
    floorPlanAreaId: AREA_WORLD_IDS.areaId,
    name: 'Guests',
    color: '#f97316',
    sortOrder: 2,
  };

  it('full-replaces name, color and sortOrder, normalizing the color', async () => {
    const { useCase, world } = await build();
    await seedArea(world);

    const result = await useCase.execute(validCommand);

    expect(result).toMatchObject({ name: 'Guests', color: '#F97316', sortOrder: 2 });
    expect(result.updatedAt).toEqual(updatedAt);
  });

  it('never moves the area to another floor plan', async () => {
    const { useCase, world } = await build();
    await seedArea(world);

    const result = await useCase.execute(validCommand);

    expect(result.floorPlanId).toBe(AREA_WORLD_IDS.floorPlanId);
  });

  it('allows keeping the current name (the exclusion of self is honored)', async () => {
    const { useCase, world } = await build();
    await seedArea(world, { name: 'Main Hall' });

    const result = await useCase.execute({ ...validCommand, name: 'Main Hall' });

    expect(result.name).toBe('Main Hall');
    expect(result.color).toBe('#F97316');
  });

  it('rejects renaming onto another live area of the same plan', async () => {
    const { useCase, world } = await build();
    await seedArea(world, { id: AREA_WORLD_IDS.areaId, name: 'Main Hall' });
    await seedArea(world, { id: AREA_WORLD_IDS.otherAreaId, name: 'Guests' });

    await expect(useCase.execute(validCommand)).rejects.toBeInstanceOf(
      FloorPlanAreaNameAlreadyExistsException,
    );
  });

  it('allows renaming onto the name of a soft-deleted area', async () => {
    const { useCase, world } = await build();
    await seedArea(world, { id: AREA_WORLD_IDS.areaId, name: 'Main Hall' });
    await seedArea(world, {
      id: AREA_WORLD_IDS.otherAreaId,
      name: 'Guests',
      deletedAt: AREA_WORLD_NOW,
    });

    await expect(useCase.execute(validCommand)).resolves.toMatchObject({ name: 'Guests' });
  });

  it('throws FloorPlanAreaNotFoundException for an area of another floor plan', async () => {
    const { useCase, world } = await build();
    await seedArea(world, { floorPlanId: AREA_WORLD_IDS.otherFloorPlanId });

    await expect(useCase.execute(validCommand)).rejects.toBeInstanceOf(
      FloorPlanAreaNotFoundException,
    );
  });

  it('leaves the stored area untouched when the color is malformed', async () => {
    const { useCase, world } = await build();
    await seedArea(world);

    await expect(useCase.execute({ ...validCommand, color: '#FFF' })).rejects.toBeInstanceOf(
      InvalidHexColorException,
    );

    const stored = await world.floorPlanAreaRepository.findByIdAndFloorPlanId(
      FloorPlanAreaId.create(AREA_WORLD_IDS.areaId),
      FloorPlanId.create(AREA_WORLD_IDS.floorPlanId),
    );
    expect(stored).toMatchObject({});
    expect(stored?.name).toBe('Main Hall');
    expect(stored?.color).toBe('#14B8A6');
  });

  it('writes a floor_plan_area.updated audit entry', async () => {
    const { useCase, world, auditLogWriter } = await build();
    await seedArea(world);

    await useCase.execute({ ...validCommand, correlationId: 'corr-2' });

    expect(auditLogWriter.entries).toHaveLength(1);
    expect(auditLogWriter.entries[0]).toMatchObject({
      action: 'floor_plan_area.updated',
      targetType: 'FloorPlanArea',
      targetId: AREA_WORLD_IDS.areaId,
      organizationId: AREA_WORLD_IDS.organizationId,
      correlationId: 'corr-2',
    });
  });
});
