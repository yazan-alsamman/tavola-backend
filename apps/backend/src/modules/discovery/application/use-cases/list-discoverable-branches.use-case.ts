import { Injectable, Inject } from '@nestjs/common';
import { BranchResult } from '@modules/branches/application/dto/branch.result';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { DiscoveryReaderPort, DISCOVERY_READER } from '../ports/discovery-reader.port';

export interface ListDiscoverableBranchesCommand {
  restaurantId: string;
  page: number;
  limit: number;
}

export interface DiscoverableBranchListResult {
  items: BranchResult[];
  page: number;
  limit: number;
  total: number;
}

/**
 * Customer Restaurant Discovery & Public Read Surface. Public/unauthenticated.
 * Resolves the parent restaurant first (tenant/visibility isolation gate,
 * same shape as every management use case's own precedent) - an unknown or
 * non-discoverable restaurant 404s before any branch query runs.
 */
@Injectable()
export class ListDiscoverableBranchesUseCase {
  constructor(@Inject(DISCOVERY_READER) private readonly discoveryReader: DiscoveryReaderPort) {}

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
    return { items: page.items, page: command.page, limit: command.limit, total: page.total };
  }
}
