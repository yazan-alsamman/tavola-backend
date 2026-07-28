import { Injectable, Inject } from '@nestjs/common';
import { BranchResult } from '@modules/branches/application/dto/branch.result';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import { DiscoveryReaderPort, DISCOVERY_READER } from '../ports/discovery-reader.port';

export interface GetDiscoverableBranchCommand {
  restaurantId: string;
  branchId: string;
}

/**
 * Customer Restaurant Discovery & Public Read Surface. Public/unauthenticated.
 * A branch belonging to a different restaurant, or an unknown/soft-deleted
 * one, 404s exactly like the parent restaurant not existing - IDOR-safe.
 */
@Injectable()
export class GetDiscoverableBranchUseCase {
  constructor(@Inject(DISCOVERY_READER) private readonly discoveryReader: DiscoveryReaderPort) {}

  async execute(command: GetDiscoverableBranchCommand): Promise<BranchResult> {
    const restaurant = await this.discoveryReader.getRestaurantById(command.restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const branch = await this.discoveryReader.getBranchById(command.branchId, command.restaurantId);
    if (branch === null) {
      throw new BranchNotFoundException();
    }
    return branch;
  }
}
