import { Injectable, Inject } from '@nestjs/common';
import { BranchResult } from '@modules/branches/application/dto/branch.result';
import { BranchWorkingHoursEntryResult } from '@modules/branches/application/dto/branch-working-hours.result';
import { ListBranchWorkingHoursByBranchIdsUseCase } from '@modules/branches/application/use-cases/list-branch-working-hours-by-branch-ids.use-case';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import { DiscoveryReaderPort, DISCOVERY_READER } from '../ports/discovery-reader.port';
import { RestaurantCoverImageUrlResolver } from '../services/restaurant-cover-image-url.resolver';

export interface GetDiscoverableBranchCommand {
  restaurantId: string;
  branchId: string;
}

export type DiscoverableBranchDetail = BranchResult & {
  workingHours: BranchWorkingHoursEntryResult[];
  /** ADR-051: the branch cover, or the restaurant cover when the branch has none. */
  coverImageUrl: string | null;
};

/**
 * Customer Restaurant Discovery & Public Read Surface. Public/unauthenticated.
 * A branch belonging to a different restaurant, or an unknown/soft-deleted
 * one, 404s exactly like the parent restaurant not existing - IDOR-safe.
 *
 * Public Working Hours: `workingHours` is this branch's own override
 * schedule (`BranchWorkingHours`, Phase 5.2) - see
 * `ListDiscoverableBranchesUseCase`'s own doc comment for the empty-array
 * semantics.
 */
@Injectable()
export class GetDiscoverableBranchUseCase {
  constructor(
    @Inject(DISCOVERY_READER) private readonly discoveryReader: DiscoveryReaderPort,
    private readonly listBranchWorkingHoursByBranchIdsUseCase: ListBranchWorkingHoursByBranchIdsUseCase,
    private readonly coverImageUrlResolver: RestaurantCoverImageUrlResolver,
  ) {}

  async execute(command: GetDiscoverableBranchCommand): Promise<DiscoverableBranchDetail> {
    const restaurant = await this.discoveryReader.getRestaurantById(command.restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const branch = await this.discoveryReader.getBranchById(command.branchId, command.restaurantId);
    if (branch === null) {
      throw new BranchNotFoundException();
    }

    const workingHoursByBranchId = await this.listBranchWorkingHoursByBranchIdsUseCase.execute({
      branchIds: [branch.branchId],
    });

    const [withCover] = await this.coverImageUrlResolver.attach([
      { ...branch, coverImageId: branch.coverImageId ?? restaurant.coverImageId },
    ]);
    return {
      ...withCover,
      workingHours: workingHoursByBranchId.get(branch.branchId) ?? [],
    };
  }
}
