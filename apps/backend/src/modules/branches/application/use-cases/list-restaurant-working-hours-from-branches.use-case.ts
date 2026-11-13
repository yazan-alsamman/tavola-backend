import { Injectable, Inject } from '@nestjs/common';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  BranchWorkingHoursRepository,
  BRANCH_WORKING_HOURS_REPOSITORY,
} from '../../domain/repositories/branch-working-hours.repository';
import { BranchWorkingHoursEntryResult } from '../dto/branch-working-hours.result';

export interface ListRestaurantWorkingHoursFromBranchesCommand {
  restaurantIds: string[];
}

/**
 * Working hours belong to branches (ADR-050). The customer app still reads a
 * restaurant-level `workingHours` on Discovery restaurant responses, so that
 * field is now the schedule of the restaurant's oldest non-deleted branch -
 * one batched query for every requested restaurant, no N+1. A restaurant with
 * no branch, or whose first branch has no rows yet, maps to an empty list.
 * Like `ListBranchWorkingHoursByBranchIdsUseCase`, it takes no actor: callers
 * (Discovery) already resolved visibility.
 */
@Injectable()
export class ListRestaurantWorkingHoursFromBranchesUseCase {
  constructor(
    @Inject(BRANCH_WORKING_HOURS_REPOSITORY)
    private readonly branchWorkingHoursRepository: BranchWorkingHoursRepository,
  ) {}

  async execute(
    command: ListRestaurantWorkingHoursFromBranchesCommand,
  ): Promise<Map<string, BranchWorkingHoursEntryResult[]>> {
    if (command.restaurantIds.length === 0) {
      return new Map();
    }
    const byRestaurantId = await this.branchWorkingHoursRepository.findForFirstBranchOfRestaurants(
      command.restaurantIds.map((id) => RestaurantId.create(id)),
    );
    const result = new Map<string, BranchWorkingHoursEntryResult[]>();
    for (const [restaurantId, entries] of byRestaurantId) {
      result.set(
        restaurantId,
        [...entries]
          .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
          .map((entry) => ({
            dayOfWeek: entry.dayOfWeek,
            openingTime: entry.openingTime,
            closingTime: entry.closingTime,
            breakStartTime: entry.breakStartTime,
            breakEndTime: entry.breakEndTime,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
          })),
      );
    }
    return result;
  }
}
