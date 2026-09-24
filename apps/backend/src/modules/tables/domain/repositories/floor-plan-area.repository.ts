import { FloorPlanArea } from '../entities/floor-plan-area.entity';
import { FloorPlanAreaId, FloorPlanId } from '@shared/domain/value-objects/identifiers.vo';

/**
 * ADR-040. No `organizationId`/`restaurantId`/`branchId` parameter on any
 * method: `FloorPlanArea` carries no direct `organizationId` column and no
 * denormalized `branchId` (decision #3), so it is tenant-owned only
 * transitively, via `floorPlanId -> FloorPlan.branchId -> Branch.restaurantId
 * -> Restaurant.organizationId` - one hop deeper than `FloorPlanRepository`,
 * same rule. Tenant isolation is the CALLER's responsibility: every use case
 * must resolve the parent Restaurant, Branch, then FloorPlan through their
 * already-tenant-scoped repositories first.
 *
 * Every lookup is compound on `floorPlanId` - there is no bare `findById`,
 * because unlike `Table` (whose flat `/tables/:tableId` routes need one) an
 * Area is only ever addressed through its FloorPlan.
 */
export interface FloorPlanAreaRepository {
  findByIdAndFloorPlanId(
    id: FloorPlanAreaId,
    floorPlanId: FloorPlanId,
  ): Promise<FloorPlanArea | null>;
  /**
   * Ordered by `sortOrder` ascending, ties broken by `createdAt` ascending -
   * the editor's tab order. Unpaginated, matching `FloorPlan`'s own "List
   * (unpaginated)" precedent: a layout's hall count is naturally bounded by
   * the physical premises.
   */
  findManyByFloorPlanId(floorPlanId: FloorPlanId): Promise<FloorPlanArea[]>;
  existsByFloorPlanIdAndName(
    floorPlanId: FloorPlanId,
    name: string,
    excludeId?: FloorPlanAreaId,
  ): Promise<boolean>;
  /**
   * Count of non-soft-deleted Tables still assigned to this Area - the input to
   * the deletion guard (decision #7). A count rather than a boolean so the
   * rejection can tell the caller how much work is left to do.
   */
  countAssignedTables(id: FloorPlanAreaId): Promise<number>;
  save(area: FloorPlanArea): Promise<void>;
}

export const FLOOR_PLAN_AREA_REPOSITORY = Symbol('FLOOR_PLAN_AREA_REPOSITORY');
