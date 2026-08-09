import { Injectable, Inject } from '@nestjs/common';
import { BranchResult } from '@modules/branches/application/dto/branch.result';
import { BranchWorkingHoursEntryResult } from '@modules/branches/application/dto/branch-working-hours.result';
import { ListBranchWorkingHoursByBranchIdsUseCase } from '@modules/branches/application/use-cases/list-branch-working-hours-by-branch-ids.use-case';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { DiscoveryReaderPort, DISCOVERY_READER } from '../ports/discovery-reader.port';

export interface ListDiscoverableBranchesCommand {
  restaurantId: string;
  page: number;
  limit: number;
}

export type DiscoverableBranch = BranchResult & {
  workingHours: BranchWorkingHoursEntryResult[];
};

export interface DiscoverableBranchListResult {
  items: DiscoverableBranch[];
  page: number;
  limit: number;
  total: number;
}

/**
 * Customer Restaurant Discovery & Public Read Surface. Public/unauthenticated.
 * Resolves the parent restaurant first (tenant/visibility isolation gate,
 * same shape as every management use case's own precedent) - an unknown or
 * non-discoverable restaurant 404s before any branch query runs.
 *
 * Public Working Hours: `workingHours` is each branch's own override
 * schedule (`BranchWorkingHours`, Phase 5.2) - an empty array means no
 * override is configured for that branch (see `BranchWorkingHours`'s own
 * Prisma model comment; no fallback to the Restaurant-level default is
 * invented here, matching this codebase's existing "out of CRUD scope"
 * precedent).
 */
@Injectable()
export class ListDiscoverableBranchesUseCase {
  constructor(
    @Inject(DISCOVERY_READER) private readonly discoveryReader: DiscoveryReaderPort,
    private readonly listBranchWorkingHoursByBranchIdsUseCase: ListBranchWorkingHoursByBranchIdsUseCase,
  ) {}

  async execute(command: ListDiscoverableBranchesCommand): Promise<DiscoverableBranchListResult> {
    const restaurant = await this.discoveryReader.getRestaurantById(command.restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const page = await this.discoveryReader.listBranchesByRestaurantId(
      command.restaurantId,
      command.page,
      command.limit,
    );

    const branchIds = page.items.map((item) => item.branchId);
    const workingHoursByBranchId = await this.listBranchWorkingHoursByBranchIdsUseCase.execute({
      branchIds,
    });

    return {
      items: page.items.map((item) => ({
        ...item,
        workingHours: workingHoursByBranchId.get(item.branchId) ?? [],
      })),
      page: command.page,
      limit: command.limit,
      total: page.total,
    };
  }
}
