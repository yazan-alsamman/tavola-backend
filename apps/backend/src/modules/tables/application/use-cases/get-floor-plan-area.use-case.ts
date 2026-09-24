import { Injectable, Inject } from '@nestjs/common';
import { FloorPlanAreaId } from '@shared/domain/value-objects/identifiers.vo';
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
import { FloorPlanAreaNotFoundException } from '../../domain/exceptions/floor-plan-area-not-found.exception';
import { resolveFloorPlanScope } from '../services/resolve-floor-plan-scope';
import { toFloorPlanAreaResult } from '../mappers/floor-plan-area-result.mapper';
import { GetFloorPlanAreaCommand } from '../dto/get-floor-plan-area.command';
import { FloorPlanAreaResult } from '../dto/floor-plan-area.result';

/**
 * ADR-040. An unknown area id, an area belonging to another FloorPlan, and a
 * soft-deleted area are all rejected identically by the one compound lookup -
 * the IDOR-safe pattern this module already applies to every nested resource.
 */
@Injectable()
export class GetFloorPlanAreaUseCase {
  constructor(
    @Inject(FLOOR_PLAN_AREA_REPOSITORY)
    private readonly floorPlanAreaRepository: FloorPlanAreaRepository,
    @Inject(FLOOR_PLAN_REPOSITORY) private readonly floorPlanRepository: FloorPlanRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
  ) {}

  async execute(command: GetFloorPlanAreaCommand): Promise<FloorPlanAreaResult> {
    const { floorPlan } = await resolveFloorPlanScope(
      {
        restaurantRepository: this.restaurantRepository,
        branchRepository: this.branchRepository,
        floorPlanRepository: this.floorPlanRepository,
      },
      command,
    );

    const area = await this.floorPlanAreaRepository.findByIdAndFloorPlanId(
      FloorPlanAreaId.create(command.floorPlanAreaId),
      floorPlan.floorPlanId,
    );
    if (area === null) {
      throw new FloorPlanAreaNotFoundException();
    }

    return toFloorPlanAreaResult(area);
  }
}
