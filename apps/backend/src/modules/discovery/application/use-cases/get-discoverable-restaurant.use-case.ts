import { Injectable, Inject } from '@nestjs/common';
import { RestaurantResult } from '@modules/restaurants/application/dto/restaurant.result';
import { WorkingHoursEntryResult } from '@modules/restaurants/application/dto/working-hours.result';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { ListWorkingHoursByRestaurantIdsUseCase } from '@modules/restaurants/application/use-cases/list-working-hours-by-restaurant-ids.use-case';
import { DiscoveryReaderPort, DISCOVERY_READER } from '../ports/discovery-reader.port';

export interface GetDiscoverableRestaurantCommand {
  restaurantId: string;
}

export type DiscoverableRestaurantDetail = RestaurantResult & {
  workingHours: WorkingHoursEntryResult[];
};

/**
 * Customer Restaurant Discovery & Public Read Surface. Public/unauthenticated.
 * Unknown, soft-deleted, or non-`Active` (e.g. `Suspended`) restaurants all
 * collapse to the same 404 - IDOR-safe, matching every other resource's
 * existing convention (never a distinguishing status).
 *
 * Public Working Hours: `workingHours` is the Restaurant-level default
 * schedule (`WorkingHours`, Phase 4.3) - never `hasActiveOffer`/`hasMenu`,
 * which remain search-family-only annotations (unchanged pre-existing
 * behavior, see `DiscoverableRestaurant`'s own doc comment).
 */
@Injectable()
export class GetDiscoverableRestaurantUseCase {
  constructor(
    @Inject(DISCOVERY_READER) private readonly discoveryReader: DiscoveryReaderPort,
    private readonly listWorkingHoursByRestaurantIdsUseCase: ListWorkingHoursByRestaurantIdsUseCase,
  ) {}

  async execute(command: GetDiscoverableRestaurantCommand): Promise<DiscoverableRestaurantDetail> {
    const restaurant = await this.discoveryReader.getRestaurantById(command.restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const workingHoursByRestaurantId = await this.listWorkingHoursByRestaurantIdsUseCase.execute({
      restaurantIds: [restaurant.restaurantId],
    });

    return {
      ...restaurant,
      workingHours: workingHoursByRestaurantId.get(restaurant.restaurantId) ?? [],
    };
  }
}
