import { Injectable, Inject } from '@nestjs/common';
import { RestaurantResult } from '@modules/restaurants/application/dto/restaurant.result';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { DiscoveryReaderPort, DISCOVERY_READER } from '../ports/discovery-reader.port';

export interface GetDiscoverableRestaurantCommand {
  restaurantId: string;
}

/**
 * Customer Restaurant Discovery & Public Read Surface. Public/unauthenticated.
 * Unknown, soft-deleted, or non-`Active` (e.g. `Suspended`) restaurants all
 * collapse to the same 404 - IDOR-safe, matching every other resource's
 * existing convention (never a distinguishing status).
 */
@Injectable()
export class GetDiscoverableRestaurantUseCase {
  constructor(@Inject(DISCOVERY_READER) private readonly discoveryReader: DiscoveryReaderPort) {}

  async execute(command: GetDiscoverableRestaurantCommand): Promise<RestaurantResult> {
    const restaurant = await this.discoveryReader.getRestaurantById(command.restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }
    return restaurant;
  }
}
