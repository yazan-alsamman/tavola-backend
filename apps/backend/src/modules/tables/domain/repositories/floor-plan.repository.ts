import { FloorPlan } from '../entities/floor-plan.entity';
import { BranchId, FloorPlanId } from '@shared/domain/value-objects/identifiers.vo';

/**
 * No `organizationId`/`restaurantId` parameter on any method: `FloorPlan`
 * carries no direct `organizationId` column (schema.prisma's `FloorPlan`
 * model comment), so it is tenant-owned only transitively, via
 * `branchId -> Branch.restaurantId -> Restaurant.organizationId` - the same
 * pattern `BranchRepository`/`BranchWorkingHoursRepository` already use.
 * Tenant isolation is the CALLER's responsibility: every use case must
 * resolve the parent Restaurant, then the parent Branch, via their
 * already-tenant-scoped repositories first.
 */
export interface FloorPlanRepository {
  findByIdAndBranchId(id: FloorPlanId, branchId: BranchId): Promise<FloorPlan | null>;
  findManyByBranchId(branchId: BranchId): Promise<FloorPlan[]>;
  existsAnyForBranch(branchId: BranchId): Promise<boolean>;
  save(floorPlan: FloorPlan): Promise<void>;
  /**
   * Atomically deactivates every other (non-soft-deleted) FloorPlan of
   * `branchId` and activates the one identified by `id`, inside one
   * transaction - Aggregate Invariant "at most one active FloorPlan per
   * Branch" (TASKS.md Phase 6.1 decision #5) is never violated even
   * transiently. Returns the freshly-activated FloorPlan.
   */
  activate(id: FloorPlanId, branchId: BranchId, at: Date): Promise<FloorPlan>;
  /**
   * Bulk soft-delete of every (non-soft-deleted) FloorPlan for one branch -
   * used only by `DeleteBranchUseCase`'s cascade (TASKS.md Phase 6.1
   * decisions #3/#6), inside its own transaction. Not a per-row entity round
   * trip, matching `BranchWorkingHoursRepository.replaceAllForBranch`'s own
   * bulk precedent.
   */
  softDeleteAllForBranch(branchId: BranchId, at: Date): Promise<void>;
}

export const FLOOR_PLAN_REPOSITORY = Symbol('FLOOR_PLAN_REPOSITORY');
