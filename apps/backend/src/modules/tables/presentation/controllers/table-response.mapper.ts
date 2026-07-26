import { TableResult } from '../../application/dto/table.result';
import { MergedUnitResult } from '../../application/dto/merged-unit.result';
import { TableResponseDto } from '../dto/table.response.dto';
import { MergedUnitResponseDto } from '../dto/merge-unit.response.dto';

/**
 * Shared by every controller that returns a `TableResponseDto`
 * (`FloorPlansController`'s floor-plan-scoped list, `TablesController`'s
 * branch-scoped create/list, `TableController`'s flat get/update) - avoids
 * duplicating the same field-by-field mapping three times.
 */
export function toTableResponse(result: TableResult): TableResponseDto {
  return {
    tableId: result.tableId,
    branchId: result.branchId,
    floorPlanId: result.floorPlanId,
    tableNumber: result.tableNumber,
    capacity: result.capacity,
    floor: result.floor,
    positionX: result.positionX,
    positionY: result.positionY,
    width: result.width,
    height: result.height,
    rotation: result.rotation,
    shape: result.shape,
    layer: result.layer,
    indoor: result.indoor,
    vip: result.vip,
    smoking: result.smoking,
    status: result.status,
    mergeGroupId: result.mergeGroupId,
    isMergePrimary: result.isMergePrimary,
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
  };
}

/**
 * Phase 6 (Merge/Split Tables, ADR-026) - shared by `TableController`'s
 * `POST /tables/merge` and `POST /tables/:tableId/split` handlers.
 */
export function toMergedUnitResponse(result: MergedUnitResult): MergedUnitResponseDto {
  return {
    mergeGroupId: result.mergeGroupId,
    primaryTableId: result.primaryTableId,
    memberTableIds: result.memberTableIds,
    effectiveCapacity: result.effectiveCapacity,
    primary: toTableResponse(result.primary),
    members: result.members.map(toTableResponse),
  };
}
