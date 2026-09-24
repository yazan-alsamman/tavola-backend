import { Injectable, Inject } from '@nestjs/common';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import {
  BranchRepository,
  BRANCH_REPOSITORY,
} from '@modules/branches/domain/repositories/branch.repository';
import {
  FloorPlanRepository,
  FLOOR_PLAN_REPOSITORY,
} from '../../domain/repositories/floor-plan.repository';
import {
  FloorPlanAreaRepository,
  FLOOR_PLAN_AREA_REPOSITORY,
} from '../../domain/repositories/floor-plan-area.repository';
import { resolveFloorPlanScope } from '../services/resolve-floor-plan-scope';
import { toFloorPlanAreaResult } from '../mappers/floor-plan-area-result.mapper';
import { ListFloorPlanAreasCommand } from '../dto/list-floor-plan-areas.command';
import { FloorPlanAreaListResult } from '../dto/floor-plan-area-list.result';

/**
 * ADR-040. Unpaginated, matching `ListFloorPlansUseCase`'s own precedent: the
 * hall count of one layout is bounded by the physical premises, and the editor
 * needs every tab at once to render the plan at all. Ordering
 * (`sortOrder` ascending, then `createdAt` ascending) is the repository's
 * responsibility, so every caller sees the same tab order.
 */
@Injectable()
export class ListFloorPlanAreasUseCase {
  constructor(
    @Inject(FLOOR_PLAN_AREA_REPOSITORY)
    private readonly floorPlanAreaRepository: FloorPlanAreaRepository,
    @Inject(FLOOR_PLAN_REPOSITORY) private readonly floorPlanRepository: FloorPlanRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
  ) {}

  async execute(command: ListFloorPlanAreasCommand): Promise<FloorPlanAreaListResult> {
    const { floorPlan } = await resolveFloorPlanScope(
      {
        restaurantRepository: this.restaurantRepository,
        branchRepository: this.branchRepository,
        floorPlanRepository: this.floorPlanRepository,
      },
      command,
    );

    const areas = await this.floorPlanAreaRepository.findManyByFloorPlanId(floorPlan.floorPlanId);

    return { items: areas.map(toFloorPlanAreaResult) };
  }
}
