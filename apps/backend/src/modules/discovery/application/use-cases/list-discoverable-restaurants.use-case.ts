import { Injectable, Inject } from '@nestjs/common';
import { RestaurantResult } from '@modules/restaurants/application/dto/restaurant.result';
import { DiscoveryReaderPort, DISCOVERY_READER } from '../ports/discovery-reader.port';

export interface ListDiscoverableRestaurantsCommand {
  page: number;
  limit: number;
}

export interface DiscoverableRestaurantListResult {
  items: RestaurantResult[];
  page: number;
  limit: number;
  total: number;
}

/**
 * Customer Restaurant Discovery & Public Read Surface. Public/unauthenticated
 * (ADR-018 §4) - no actor, no tenant scope. Never a search/filter/nearby/
 * ranking capability (that remains ADR-018's own future Phase 15.5 Discovery
 * module) - plain paginated listing of `Active`, non-soft-deleted
 * restaurants only, newest-created first.
 */
@Injectable()
export class ListDiscoverableRestaurantsUseCase {
  constructor(@Inject(DISCOVERY_READER) private readonly discoveryReader: DiscoveryReaderPort) {}

  async execute(
    command: ListDiscoverableRestaurantsCommand,
  ): Promise<DiscoverableRestaurantListResult> {
    const page = await this.discoveryReader.listRestaurants(command.page, command.limit);
    return { items: page.items, page: command.page, limit: command.limit, total: page.total };
  }
}
