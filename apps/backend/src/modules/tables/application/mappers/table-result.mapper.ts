import { Table } from '../../domain/entities/table.entity';
import { TableResult } from '../dto/table.result';

export function toTableResult(table: Table): TableResult {
  return {
    tableId: table.tableId.value,
    branchId: table.branchId.value,
    floorPlanId: table.floorPlanId.value,
    tableNumber: table.tableNumber,
    capacity: table.capacity,
    floor: table.floor,
    positionX: table.positionX,
    positionY: table.positionY,
    width: table.width,
    height: table.height,
    rotation: table.rotation,
    shape: table.shape,
    layer: table.layer,
    indoor: table.indoor,
    vip: table.vip,
    smoking: table.smoking,
    status: table.status,
    mergeGroupId: table.mergeGroupId,
    createdAt: table.createdAt,
    updatedAt: table.updatedAt,
  };
}
