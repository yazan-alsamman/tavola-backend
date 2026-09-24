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
import {
  FloorPlanAreaRepository,
  FLOOR_PLAN_AREA_REPOSITORY,
} from '../../domain/repositories/floor-plan-area.repository';
import { FloorPlanNotFoundException } from '../../domain/exceptions/floor-plan-not-found.exception';
import { resolveFloorPlanAreaId } from '../services/resolve-floor-plan-area';
import { toTableResult } from '../mappers/table-result.mapper';
import { ListTablesByFloorPlanCommand } from '../dto/list-tables-by-floor-plan.command';
import { TableListResult } from '../dto/table-list.result';

/**
 * FloorPlan-scoped Table read capability (TASKS.md Phase 6.1 decision #4) -
 * nested three levels deep under the already fully-qualified FloorPlan
 * resource (`GET .../branches/:branchId/floor-plans/:floorPlanId/tables`),
 * matching Phase 5.2's own "append a sub-resource segment after the already-
 * fully-qualified parent" precedent (`BranchWorkingHours`).
 *
 * ADR-040 decision #10 - the optional `floorPlanAreaId` filter narrows the
 * result to one hall. Implemented as a filter on this existing route rather
 * than as a fifth nesting level (`.../areas/:areaId/tables`): it adds no
 * capability that route would not have, and the pagination/ordering contract
 * stays in one place. An id that is not a live Area of THIS plan is rejected
 * (404) by the shared resolver rather than silently ignored - a filter that
 * quietly widens to "everything" is how a client ends up trusting a wrong
 * screen.
 */
@Injectable()
export class ListTablesByFloorPlanUseCase {
  constructor(
    @Inject(TABLE_REPOSITORY) private readonly tableRepository: TableRepository,
    @Inject(FLOOR_PLAN_REPOSITORY) private readonly floorPlanRepository: FloorPlanRepository,
    @Inject(FLOOR_PLAN_AREA_REPOSITORY)
    private readonly floorPlanAreaRepository: FloorPlanAreaRepository,
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

    const floorPlanAreaId = await resolveFloorPlanAreaId(
      this.floorPlanAreaRepository,
      floorPlanId,
      command.floorPlanAreaId,
    );

    const page = await this.tableRepository.findManyByFloorPlanId(
      floorPlanId,
      command.page,
      command.limit,
      floorPlanAreaId ?? undefined,
    );

    return {
      items: page.items.map(toTableResult),
      page: command.page,
      limit: command.limit,
      total: page.total,
    };
  }
}
