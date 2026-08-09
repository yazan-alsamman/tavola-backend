import { Injectable, Inject } from '@nestjs/common';
import { BranchId } from '@shared/domain/value-objects/identifiers.vo';
import {
  BranchWorkingHoursRepository,
  BRANCH_WORKING_HOURS_REPOSITORY,
} from '../../domain/repositories/branch-working-hours.repository';
import { BranchWorkingHoursEntryResult } from '../dto/branch-working-hours.result';

export interface ListBranchWorkingHoursByBranchIdsCommand {
  branchIds: string[];
}

/**
 * Public Working Hours (customer-facing correction). Sole authority for
 * "what are these branches' weekly hours override" in batched form - reuses
 * `BranchWorkingHoursRepository.findAllByBranchIds` (one `IN (...)` query, no
 * N+1), mirroring `ListWorkingHoursByRestaurantIdsUseCase`'s exact pattern.
 * Deliberately takes no actor and performs no branch-visibility check of its
 * own - callers (Discovery's list/get branch use cases) already resolved
 * visibility via `DiscoveryReaderPort` before calling this, so this use case
 * never resolves `RESTAURANT_REPOSITORY`/`BRANCH_REPOSITORY` (tenant-enforced
 * or tenant-adjacent, would be a needless second lookup under Discovery's
 * unauthenticated, no-tenant-context call path).
 */
@Injectable()
export class ListBranchWorkingHoursByBranchIdsUseCase {
  constructor(
    @Inject(BRANCH_WORKING_HOURS_REPOSITORY)
    private readonly branchWorkingHoursRepository: BranchWorkingHoursRepository,
  ) {}

  async execute(
    command: ListBranchWorkingHoursByBranchIdsCommand,
  ): Promise<Map<string, BranchWorkingHoursEntryResult[]>> {
    if (command.branchIds.length === 0) {
      return new Map();
    }

    const branchIds = command.branchIds.map((id) => BranchId.create(id));
    const entries = await this.branchWorkingHoursRepository.findAllByBranchIds(branchIds);

    const byBranchId = new Map<string, BranchWorkingHoursEntryResult[]>();
    for (const entry of [...entries].sort((a, b) => a.dayOfWeek - b.dayOfWeek)) {
      const key = entry.branchId.value;
      const list = byBranchId.get(key) ?? [];
      list.push({
        dayOfWeek: entry.dayOfWeek,
        openingTime: entry.openingTime,
        closingTime: entry.closingTime,
        breakStartTime: entry.breakStartTime,
        breakEndTime: entry.breakEndTime,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      });
      byBranchId.set(key, list);
    }
    return byBranchId;
  }
}
