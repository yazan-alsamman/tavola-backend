import { FloorPlan } from '../../domain/entities/floor-plan.entity';
import { FloorPlanResult } from '../dto/floor-plan.result';

export function toFloorPlanResult(floorPlan: FloorPlan): FloorPlanResult {
  return {
    floorPlanId: floorPlan.floorPlanId.value,
    branchId: floorPlan.branchId.value,
    name: floorPlan.name,
    isActive: floorPlan.isActive,
    createdAt: floorPlan.createdAt,
    updatedAt: floorPlan.updatedAt,
  };
}
