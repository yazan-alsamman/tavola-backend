import { DeleteFloorPlanAreaUseCase } from './delete-floor-plan-area.use-case';
import { FloorPlanAreaNotFoundException } from '../../domain/exceptions/floor-plan-area-not-found.exception';
import { FloorPlanAreaInUseException } from '../../domain/exceptions/floor-plan-area-in-use.exception';
import { Table } from '../../domain/entities/table.entity';
import { TableShape, TableStatus } from '../../domain/enums/table.enums';
import { FloorPlanAreaId, FloorPlanId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CollectingAuditLogWriter,
  FixedClock,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import {
  areaWorldActor,
  buildFloorPlanAreaWorld,
  seedArea,
  FloorPlanAreaWorld,
  AREA_WORLD_IDS,
  AREA_WORLD_NOW,
} from '../../../../../test/tables/support/floor-plan-area-world';

describe('DeleteFloorPlanAreaUseCase (ADR-040)', () => {
  const deletedAt = new Date('2026-09-24T14:00:00.000Z');

  async function build() {
    const world = await buildFloorPlanAreaWorld();
    const auditLogWriter = new CollectingAuditLogWriter();
    const useCase = new DeleteFloorPlanAreaUseCase(
      world.floorPlanAreaRepository,
      world.floorPlanRepository,
      world.branchRepository,
      world.restaurantRepository,
      new FixedClock(deletedAt),
      auditLogWriter,
    );
    return { useCase, world, auditLogWriter };
  }

  async function seedTableInArea(
    world: FloorPlanAreaWorld,
    floorPlanAreaId: string | null,
    options: { tableId?: string; softDeleted?: boolean } = {},
  ): Promise<void> {
    const table = Table.create({
      id: options.tableId ?? '99999999-9999-4999-8999-999999999993',
      branchId: AREA_WORLD_IDS.branchId,
      floorPlanId: AREA_WORLD_IDS.floorPlanId,
      floorPlanAreaId,
      tableNumber: 'T1',
      capacity: 4,
      floor: null,
      positionX: null,
      positionY: null,
      width: null,
      height: null,
      rotation: null,
      shape: TableShape.Rectangle,
      color: null,
      layer: null,
      indoor: true,
      vip: false,
      smoking: false,
      status: TableStatus.Available,
      mergeGroupId: null,
      isMergePrimary: false,
      createdAt: AREA_WORLD_NOW,
      updatedAt: AREA_WORLD_NOW,
      deletedAt: null,
    });
    await world.tableRepository.save(
      options.softDeleted ? table.softDelete(AREA_WORLD_NOW) : table,
    );
  }

  const validCommand = {
    actor: areaWorldActor(),
    restaurantId: AREA_WORLD_IDS.restaurantId,
    branchId: AREA_WORLD_IDS.branchId,
    floorPlanId: AREA_WORLD_IDS.floorPlanId,
    floorPlanAreaId: AREA_WORLD_IDS.areaId,
  };

  it('soft-deletes an empty area', async () => {
    const { useCase, world } = await build();
    await seedArea(world);

    await useCase.execute(validCommand);

    await expect(
      world.floorPlanAreaRepository.findByIdAndFloorPlanId(
        FloorPlanAreaId.create(AREA_WORLD_IDS.areaId),
        FloorPlanId.create(AREA_WORLD_IDS.floorPlanId),
      ),
    ).resolves.toBeNull();
  });

  it('rejects deletion while a live table is still assigned, and keeps the area', async () => {
    const { useCase, world } = await build();
    await seedArea(world);
    await seedTableInArea(world, AREA_WORLD_IDS.areaId);

    await expect(useCase.execute(validCommand)).rejects.toBeInstanceOf(FloorPlanAreaInUseException);

    await expect(
      world.floorPlanAreaRepository.findByIdAndFloorPlanId(
        FloorPlanAreaId.create(AREA_WORLD_IDS.areaId),
        FloorPlanId.create(AREA_WORLD_IDS.floorPlanId),
      ),
    ).resolves.not.toBeNull();
  });

  it('reports how many tables are blocking the deletion', async () => {
    const { useCase, world } = await build();
    await seedArea(world);
    await seedTableInArea(world, AREA_WORLD_IDS.areaId, { tableId: AREA_WORLD_IDS.otherAreaId });

    await expect(useCase.execute(validCommand)).rejects.toThrow(/1 table/);
  });

  it('ignores soft-deleted tables when applying the guard', async () => {
    const { useCase, world } = await build();
    await seedArea(world);
    await seedTableInArea(world, AREA_WORLD_IDS.areaId, { softDeleted: true });

    await expect(useCase.execute(validCommand)).resolves.toBeUndefined();
  });

  it('ignores tables that sit on the layout itself rather than in this area', async () => {
    const { useCase, world } = await build();
    await seedArea(world);
    await seedTableInArea(world, null);

    await expect(useCase.execute(validCommand)).resolves.toBeUndefined();
  });

  it('throws FloorPlanAreaNotFoundException for an area of another floor plan', async () => {
    const { useCase, world } = await build();
    await seedArea(world, { floorPlanId: AREA_WORLD_IDS.otherFloorPlanId });

    await expect(useCase.execute(validCommand)).rejects.toBeInstanceOf(
      FloorPlanAreaNotFoundException,
    );
  });

  it('is not idempotent: deleting an already-deleted area is a not-found', async () => {
    const { useCase, world } = await build();
    await seedArea(world, { deletedAt: AREA_WORLD_NOW });

    await expect(useCase.execute(validCommand)).rejects.toBeInstanceOf(
      FloorPlanAreaNotFoundException,
    );
  });

  it('writes a floor_plan_area.deleted audit entry', async () => {
    const { useCase, world, auditLogWriter } = await build();
    await seedArea(world);

    await useCase.execute({ ...validCommand, correlationId: 'corr-3' });

    expect(auditLogWriter.entries).toHaveLength(1);
    expect(auditLogWriter.entries[0]).toMatchObject({
      action: 'floor_plan_area.deleted',
      targetType: 'FloorPlanArea',
      targetId: AREA_WORLD_IDS.areaId,
      organizationId: AREA_WORLD_IDS.organizationId,
      correlationId: 'corr-3',
    });
  });

  it('writes no audit entry when the guard rejects the deletion', async () => {
    const { useCase, world, auditLogWriter } = await build();
    await seedArea(world);
    await seedTableInArea(world, AREA_WORLD_IDS.areaId);

    await expect(useCase.execute(validCommand)).rejects.toBeInstanceOf(FloorPlanAreaInUseException);

    expect(auditLogWriter.entries).toHaveLength(0);
  });
});
