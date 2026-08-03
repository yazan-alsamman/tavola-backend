import { Injectable, Inject } from '@nestjs/common';
import { ListRestaurantIdsWithActiveOfferUseCase } from '@modules/offers/application/use-cases/list-restaurant-ids-with-active-offer.use-case';
import { ListRestaurantIdsWithMenuUseCase } from '@modules/menus/application/use-cases/list-restaurant-ids-with-menu.use-case';
import {
  NearbyRestaurantResult,
  DiscoveryReaderPort,
  DISCOVERY_READER,
} from '../ports/discovery-reader.port';

export interface NearbyRestaurantsCommand {
  lat: number;
  lng: number;
  radiusKm: number;
  page: number;
  limit: number;
  q?: string;
  cuisineId?: string;
  occasionId?: string;
  priceLevel?: number;
  minRating?: number;
}

export type NearbyDiscoverableRestaurant = NearbyRestaurantResult & {
  hasActiveOffer: boolean;
  hasMenu: boolean;
};

export interface NearbyRestaurantListResult {
  items: NearbyDiscoverableRestaurant[];
  page: number;
  limit: number;
  total: number;
}

/**
 * Phase 15.5 (Discovery Module, architecture frozen 2026-07-29, D2/D3/D4/D9):
 * "Nearby Restaurants API". Public/unauthenticated, same as every Discovery
 * route (ADR-018 §4). Delegates the entire bounding-box + Haversine
 * algorithm, Restaurant deduplication, and ordering to
 * `DiscoveryReaderPort.searchNearby` (D4/D13 - "handle bounding box
 * correctness in the reader, not the use case") and only annotates
 * `hasActiveOffer` on the resulting page, mirroring
 * `ListDiscoverableRestaurantsUseCase`'s exact pattern for the same
 * annotation (D9 - "do not invent a second definition").
 */
@Injectable()
export class NearbyRestaurantsUseCase {
  constructor(
    @Inject(DISCOVERY_READER) private readonly discoveryReader: DiscoveryReaderPort,
    private readonly listRestaurantIdsWithActiveOfferUseCase: ListRestaurantIdsWithActiveOfferUseCase,
    private readonly listRestaurantIdsWithMenuUseCase: ListRestaurantIdsWithMenuUseCase,
  ) {}

  async execute(command: NearbyRestaurantsCommand): Promise<NearbyRestaurantListResult> {
    const page = await this.discoveryReader.searchNearby({
      lat: command.lat,
      lng: command.lng,
      radiusKm: command.radiusKm,
      page: command.page,
      limit: command.limit,
      q: command.q,
      cuisineId: command.cuisineId,
      occasionId: command.occasionId,
      priceLevel: command.priceLevel,
      minRating: command.minRating,
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
