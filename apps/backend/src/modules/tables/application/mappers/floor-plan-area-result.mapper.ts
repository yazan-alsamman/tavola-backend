import { FloorPlanArea } from '../../domain/entities/floor-plan-area.entity';
import { FloorPlanAreaResult } from '../dto/floor-plan-area.result';

export function toFloorPlanAreaResult(area: FloorPlanArea): FloorPlanAreaResult {
  return {
    floorPlanAreaId: area.floorPlanAreaId.value,
    floorPlanId: area.floorPlanId.value,
    name: area.name,
    color: area.color,
    sortOrder: area.sortOrder,
    createdAt: area.createdAt,
    updatedAt: area.updatedAt,
  };
}
