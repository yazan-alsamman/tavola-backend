import { BranchId, FloorPlanId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { RestaurantRepository } from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { BranchRepository } from '@modules/branches/domain/repositories/branch.repository';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import { FloorPlanRepository } from '../../domain/repositories/floor-plan.repository';
import { FloorPlanNotFoundException } from '../../domain/exceptions/floor-plan-not-found.exception';
import { FloorPlan } from '../../domain/entities/floor-plan.entity';

export interface FloorPlanScopeRepositories {
  restaurantRepository: RestaurantRepository;
  branchRepository: BranchRepository;
  floorPlanRepository: FloorPlanRepository;
}

export interface FloorPlanScopeIds {
  restaurantId: string;
  branchId: string;
  floorPlanId: string;
}

export interface FloorPlanScope {
  organizationId: string;
  branchId: BranchId;
  floorPlan: FloorPlan;
}

/**
 * ADR-040 - the tenant isolation gate shared by every FloorPlanArea use case.
 *
 * `FloorPlanArea` carries no `organizationId` and no denormalized `branchId`
 * (decision #3), so it is tenant-owned three hops up: `floorPlanId ->
 * FloorPlan.branchId -> Branch.restaurantId -> Restaurant.organizationId`.
 * Walking that chain downward through the already-tenant-scoped Restaurant and
 * Branch repositories BEFORE touching the area repository is what makes an area
 * lookup safe - exactly the pattern `CreateFloorPlanUseCase` documents, one
 * level deeper.
 *
 * Extracted as a function because five use cases need the identical five-step
 * walk; inlining it would be the same code five times, and a single missing
 * step is a cross-tenant read. The returned `organizationId` is the verified
 * owner, taken from the Restaurant row rather than from the caller's token.
 */
export async function resolveFloorPlanScope(
  repositories: FloorPlanScopeRepositories,
  ids: FloorPlanScopeIds,
): Promise<FloorPlanScope> {
  const restaurantId = RestaurantId.create(ids.restaurantId);
  const restaurant = await repositories.restaurantRepository.findById(restaurantId);
  if (restaurant === null) {
    throw new RestaurantNotFoundException();
  }

  const branchId = BranchId.create(ids.branchId);
  const branch = await repositories.branchRepository.findByIdAndRestaurantId(
    branchId,
    restaurantId,
  );
  if (branch === null) {
    throw new BranchNotFoundException();
  }

  const floorPlan = await repositories.floorPlanRepository.findByIdAndBranchId(
    FloorPlanId.create(ids.floorPlanId),
    branchId,
  );
  if (floorPlan === null) {
    throw new FloorPlanNotFoundException();
  }

  return { organizationId: restaurant.organizationId.value, branchId, floorPlan };
}
