import { Injectable, Inject } from '@nestjs/common';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  WorkingHoursRepository,
  WORKING_HOURS_REPOSITORY,
} from '../../domain/repositories/working-hours.repository';
import { WorkingHoursEntryResult } from '../dto/working-hours.result';

export interface ListWorkingHoursByRestaurantIdsCommand {
  restaurantIds: string[];
}

/**
 * Public Working Hours (customer-facing correction). Sole authority for
 * "what are these restaurants' default weekly hours" in batched form -
 * reuses `WorkingHoursRepository.findAllByRestaurantIds` (one `IN (...)`
 * query, no N+1), mirroring `ListRestaurantIdsWithActiveOfferUseCase`'s exact
 * pattern (Phase 15.5, D9). Deliberately takes no actor and performs no
 * restaurant-visibility check of its own - callers (Discovery's list/get/
 * nearby/compare use cases) already resolved visibility via
 * `DiscoveryReaderPort` before calling this, so this use case never resolves
 * `RESTAURANT_REPOSITORY` (which IS tenant-enforced and would throw
 * `TenantContextMissingException` under Discovery's unauthenticated,
 * no-tenant-context call path - see `WorkingHoursRepository`'s own doc
 * comment on why this passthrough is safe without that gate).
 */
@Injectable()
export class ListWorkingHoursByRestaurantIdsUseCase {
  constructor(
    @Inject(WORKING_HOURS_REPOSITORY)
    private readonly workingHoursRepository: WorkingHoursRepository,
  ) {}

  async execute(
    command: ListWorkingHoursByRestaurantIdsCommand,
  ): Promise<Map<string, WorkingHoursEntryResult[]>> {
    if (command.restaurantIds.length === 0) {
      return new Map();
    }

    const restaurantIds = command.restaurantIds.map((id) => RestaurantId.create(id));
    const entries = await this.workingHoursRepository.findAllByRestaurantIds(restaurantIds);

    const byRestaurantId = new Map<string, WorkingHoursEntryResult[]>();
    for (const entry of [...entries].sort((a, b) => a.dayOfWeek - b.dayOfWeek)) {
      const key = entry.restaurantId.value;
      const list = byRestaurantId.get(key) ?? [];
      list.push({
        dayOfWeek: entry.dayOfWeek,
        openingTime: entry.openingTime,
        closingTime: entry.closingTime,
        breakStartTime: entry.breakStartTime,
        breakEndTime: entry.breakEndTime,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      });
      byRestaurantId.set(key, list);
    }
    return byRestaurantId;
  }
}
