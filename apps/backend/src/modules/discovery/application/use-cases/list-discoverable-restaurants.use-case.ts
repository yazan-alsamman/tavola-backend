import { Injectable, Inject } from '@nestjs/common';
import { RestaurantResult } from '@modules/restaurants/application/dto/restaurant.result';
import { ListRestaurantIdsWithActiveOfferUseCase } from '@modules/offers/application/use-cases/list-restaurant-ids-with-active-offer.use-case';
import { ListRestaurantIdsWithMenuUseCase } from '@modules/menus/application/use-cases/list-restaurant-ids-with-menu.use-case';
import {
  DiscoverableRestaurantSort,
  DiscoveryReaderPort,
  DISCOVERY_READER,
  SortOrder,
} from '../ports/discovery-reader.port';

export interface ListDiscoverableRestaurantsCommand {
  page: number;
  limit: number;
  /** Phase 15.5 (architecture frozen 2026-07-29, D5-D7/D9) - all optional, backward-compatible with the pre-existing plain listing. */
  q?: string;
  cuisineId?: string;
  occasionId?: string;
  priceLevel?: number;
  minRating?: number;
  city?: string;
  sort?: DiscoverableRestaurantSort;
  order?: SortOrder;
}

export type DiscoverableRestaurant = RestaurantResult & {
  hasActiveOffer: boolean;
  hasMenu: boolean;
};

export interface DiscoverableRestaurantListResult {
  items: DiscoverableRestaurant[];
  page: number;
  limit: number;
  total: number;
}

/**
 * Customer Restaurant Discovery & Public Read Surface. Public/unauthenticated
 * (ADR-018 §4) - no actor, no tenant scope. Backs `GET /discovery/restaurants`
 * both before and after Phase 15.5: with no filters/sort supplied this is
 * still the original plain paginated listing of `Active`, non-soft-deleted
 * restaurants, newest-created first; Phase 15.5 (architecture frozen
 * 2026-07-29, D5-D7/D9) extends it with optional text/taxonomy/price/rating
 * filters, deterministic sorting, and a `hasActiveOffer` annotation - never a
 * second, competing use case (task instructions §5 "extend the existing").
 */
@Injectable()
export class ListDiscoverableRestaurantsUseCase {
  constructor(
    @Inject(DISCOVERY_READER) private readonly discoveryReader: DiscoveryReaderPort,
    private readonly listRestaurantIdsWithActiveOfferUseCase: ListRestaurantIdsWithActiveOfferUseCase,
    private readonly listRestaurantIdsWithMenuUseCase: ListRestaurantIdsWithMenuUseCase,
  ) {}

  async execute(
    command: ListDiscoverableRestaurantsCommand,
  ): Promise<DiscoverableRestaurantListResult> {
    const page = await this.discoveryReader.listRestaurants({
      page: command.page,
      limit: command.limit,
      q: command.q,
      cuisineId: command.cuisineId,
      occasionId: command.occasionId,
      priceLevel: command.priceLevel,
      minRating: command.minRating,
      city: command.city,
      sort: command.sort,
      order: command.order,
    });

    const restaurantIds = page.items.map((item) => item.restaurantId);
    const [restaurantsWithActiveOffer, restaurantsWithMenu] = await Promise.all([
      this.listRestaurantIdsWithActiveOfferUseCase.execute({ restaurantIds }),
      this.listRestaurantIdsWithMenuUseCase.execute({ restaurantIds }),
    ]);

    return {
      items: page.items.map((item) => ({
        ...item,
        hasActiveOffer: restaurantsWithActiveOffer.has(item.restaurantId),
        hasMenu: restaurantsWithMenu.has(item.restaurantId),
      })),
      page: command.page,
      limit: command.limit,
      total: page.total,
    };
  }
}
