import { Injectable, Inject } from '@nestjs/common';
import { ListRestaurantIdsWithActiveOfferUseCase } from '@modules/offers/application/use-cases/list-restaurant-ids-with-active-offer.use-case';
import { ListRestaurantIdsWithMenuUseCase } from '@modules/menus/application/use-cases/list-restaurant-ids-with-menu.use-case';
import { RestaurantResult } from '@modules/restaurants/application/dto/restaurant.result';
import { DiscoveryReaderPort, DISCOVERY_READER } from '../ports/discovery-reader.port';

export interface CompareRestaurantsCommand {
  restaurantIds: string[];
}

export type ComparableRestaurant = RestaurantResult & { hasActiveOffer: boolean; hasMenu: boolean };

export interface CompareRestaurantsResult {
  items: ComparableRestaurant[];
}

/**
 * Phase 15.5 (Discovery Module, architecture frozen 2026-07-29, D15/D18/D19):
 * "Restaurant Comparison API" per ADR-018 §"Comparison API" - stateless, no
 * persistence, no `Comparison`/`ComparisonHistory` model. Count (2-5) and
 * uniqueness of `restaurantIds` are validated at the DTO boundary
 * (`CompareRestaurantsRequestDto`), not re-validated here.
 *
 * Security (D19): only restaurants satisfying ordinary public Discovery
 * visibility (`Active`, non-deleted) can appear. An id that does not resolve
 * to a visible restaurant - unknown, soft-deleted, or `Suspended` - is
 * silently omitted from the result, never surfaced as a distinct error; a
 * partial-404 or per-id error response would let a caller probe for the
 * existence of hidden/deleted restaurants by comparing error shapes across
 * requests, exactly the IDOR-style oracle every other Discovery route
 * already guards against by collapsing every "not visible" reason to the
 * same outcome.
 *
 * Preserves the caller-requested `restaurantIds` order (owner decision,
 * §18 "preserve caller-requested ordering if the frozen contract specifies
 * it") - a side-by-side comparison UI reads more naturally in the order the
 * caller selected the restaurants, not an arbitrary database order.
 */
@Injectable()
export class CompareRestaurantsUseCase {
  constructor(
    @Inject(DISCOVERY_READER) private readonly discoveryReader: DiscoveryReaderPort,
    private readonly listRestaurantIdsWithActiveOfferUseCase: ListRestaurantIdsWithActiveOfferUseCase,
    private readonly listRestaurantIdsWithMenuUseCase: ListRestaurantIdsWithMenuUseCase,
  ) {}

  async execute(command: CompareRestaurantsCommand): Promise<CompareRestaurantsResult> {
    const visibleRestaurants = await this.discoveryReader.getRestaurantsByIds(
      command.restaurantIds,
    );
    const byId = new Map(
      visibleRestaurants.map((restaurant) => [restaurant.restaurantId, restaurant]),
    );

    const orderedVisible = command.restaurantIds
      .map((id) => byId.get(id))
      .filter((restaurant): restaurant is RestaurantResult => restaurant !== undefined);

    const restaurantIds = orderedVisible.map((restaurant) => restaurant.restaurantId);
    const [restaurantsWithActiveOffer, restaurantsWithMenu] = await Promise.all([
      this.listRestaurantIdsWithActiveOfferUseCase.execute({ restaurantIds }),
      this.listRestaurantIdsWithMenuUseCase.execute({ restaurantIds }),
    ]);

    return {
      items: orderedVisible.map((restaurant) => ({
        ...restaurant,
        hasActiveOffer: restaurantsWithActiveOffer.has(restaurant.restaurantId),
        hasMenu: restaurantsWithMenu.has(restaurant.restaurantId),
      })),
    };
  }
}
