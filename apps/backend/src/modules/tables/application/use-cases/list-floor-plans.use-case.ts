import { Injectable, Inject } from '@nestjs/common';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import {
  BranchRepository,
  BRANCH_REPOSITORY,
} from '@modules/branches/domain/repositories/branch.repository';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import {
  FloorPlanRepository,
  FLOOR_PLAN_REPOSITORY,
} from '../../domain/repositories/floor-plan.repository';
import { toFloorPlanResult } from '../mappers/floor-plan-result.mapper';
import { ListFloorPlansCommand } from '../dto/list-floor-plans.command';
import { FloorPlanListResult } from '../dto/floor-plan-list.result';

@Injectable()
export class ListFloorPlansUseCase {
  constructor(
    @Inject(FLOOR_PLAN_REPOSITORY) private readonly floorPlanRepository: FloorPlanRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
  ) {}

  async execute(command: ListFloorPlansCommand): Promise<FloorPlanListResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);

    // Tenant isolation gate - see CreateFloorPlanUseCase's own comment.
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const branchId = BranchId.create(command.branchId);
    const branch = await this.branchRepository.findByIdAndRestaurantId(branchId, restaurantId);
    if (branch === null) {
      throw new BranchNotFoundException();
    }

    // Unpaginated: a Branch's FloorPlan count is small and bounded (one per
    // physical/seasonal layout), matching BranchWorkingHours'
    // findAllByBranchId precedent rather than ListBranches' paginated
    // collection (potentially many rows per restaurant).
    const floorPlans = await this.floorPlanRepository.findManyByBranchId(branchId);

    return { items: floorPlans.map(toFloorPlanResult) };
  }
}
