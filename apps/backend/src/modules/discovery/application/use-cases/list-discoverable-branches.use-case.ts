import { Injectable, Inject } from '@nestjs/common';
import { BranchResult } from '@modules/branches/application/dto/branch.result';
import { BranchWorkingHoursEntryResult } from '@modules/branches/application/dto/branch-working-hours.result';
import { ListBranchWorkingHoursByBranchIdsUseCase } from '@modules/branches/application/use-cases/list-branch-working-hours-by-branch-ids.use-case';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { DiscoveryReaderPort, DISCOVERY_READER } from '../ports/discovery-reader.port';
import { RestaurantCoverImageUrlResolver } from '../services/restaurant-cover-image-url.resolver';

export interface ListDiscoverableBranchesCommand {
  restaurantId: string;
  page: number;
  limit: number;
}

export type DiscoverableBranch = BranchResult & {
  workingHours: BranchWorkingHoursEntryResult[];
  /** ADR-051: the branch cover, or the restaurant cover when the branch has none. */
  coverImageUrl: string | null;
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
 * Public Working Hours: `workingHours` is each branch's own weekly
 * schedule (`BranchWorkingHours`, the only source of opening hours since
 * ADR-050) - an empty array means the branch has not set its hours yet.
 */
@Injectable()
export class ListDiscoverableBranchesUseCase {
  constructor(
    @Inject(DISCOVERY_READER) private readonly discoveryReader: DiscoveryReaderPort,
    private readonly listBranchWorkingHoursByBranchIdsUseCase: ListBranchWorkingHoursByBranchIdsUseCase,
    private readonly coverImageUrlResolver: RestaurantCoverImageUrlResolver,
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

    const withCovers = await this.coverImageUrlResolver.attach(
      page.items.map((item) => ({
        ...item,
        coverImageId: item.coverImageId ?? restaurant.coverImageId,
      })),
    );

    return {
      items: withCovers.map((item) => ({
        ...item,
        workingHours: workingHoursByBranchId.get(item.branchId) ?? [],
      })),
      page: command.page,
      limit: command.limit,
      total: page.total,
    };
  }
}
