import { Injectable, Inject } from '@nestjs/common';
import { BranchId, FloorPlanId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
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
import { TableRepository, TABLE_REPOSITORY } from '../../domain/repositories/table.repository';
import {
  FloorPlanRepository,
  FLOOR_PLAN_REPOSITORY,
} from '../../domain/repositories/floor-plan.repository';
import { FloorPlanNotFoundException } from '../../domain/exceptions/floor-plan-not-found.exception';
import { toTableResult } from '../mappers/table-result.mapper';
import { ListTablesByFloorPlanCommand } from '../dto/list-tables-by-floor-plan.command';
import { TableListResult } from '../dto/table-list.result';

/**
 * FloorPlan-scoped Table read capability (TASKS.md Phase 6.1 decision #4) -
 * nested three levels deep under the already fully-qualified FloorPlan
 * resource (`GET .../branches/:branchId/floor-plans/:floorPlanId/tables`),
 * matching Phase 5.2's own "append a sub-resource segment after the already-
 * fully-qualified parent" precedent (`BranchWorkingHours`).
 */
@Injectable()
export class ListTablesByFloorPlanUseCase {
  constructor(
    @Inject(TABLE_REPOSITORY) private readonly tableRepository: TableRepository,
    @Inject(FLOOR_PLAN_REPOSITORY) private readonly floorPlanRepository: FloorPlanRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
  ) {}

  async execute(command: ListTablesByFloorPlanCommand): Promise<TableListResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);

    // Tenant isolation gate - see CreateTableUseCase's own comment.
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const branchId = BranchId.create(command.branchId);
    const branch = await this.branchRepository.findByIdAndRestaurantId(branchId, restaurantId);
    if (branch === null) {
      throw new BranchNotFoundException();
    }

    const floorPlanId = FloorPlanId.create(command.floorPlanId);
    const floorPlan = await this.floorPlanRepository.findByIdAndBranchId(floorPlanId, branchId);
    if (floorPlan === null) {
      throw new FloorPlanNotFoundException();
    }

    const page = await this.tableRepository.findManyByFloorPlanId(
      floorPlanId,
      command.page,
      command.limit,
    );

    return {
      items: page.items.map(toTableResult),
      page: command.page,
      limit: command.limit,
      total: page.total,
    };
  }
}
