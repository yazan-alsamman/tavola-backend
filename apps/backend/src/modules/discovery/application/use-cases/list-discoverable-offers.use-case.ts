import { Injectable, Inject } from '@nestjs/common';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { ListPublicOffersUseCase } from '@modules/offers/application/use-cases/list-public-offers.use-case';
import { OfferListResult } from '@modules/offers/application/dto/offer-list.result';
import { DiscoveryReaderPort, DISCOVERY_READER } from '../ports/discovery-reader.port';

export interface ListDiscoverableOffersCommand {
  restaurantId: string;
  page: number;
  limit: number;
}

/**
 * Customer Restaurant Discovery & Public Read Surface, Phase 11 integration
 * (2026-07-28). Compositional only (task instructions §6): resolves the
 * restaurant-visibility gate itself (same IDOR-safe 404 as every other
 * Discovery route), then delegates entirely to `ListPublicOffersUseCase`
 * (Offers module) for what counts as an "active public Offer" - the `type`/
 * `status`/temporal-window rules are never duplicated here.
 */
@Injectable()
export class ListDiscoverableOffersUseCase {
  constructor(
    @Inject(DISCOVERY_READER) private readonly discoveryReader: DiscoveryReaderPort,
    private readonly listPublicOffersUseCase: ListPublicOffersUseCase,
  ) {}

  async execute(command: ListDiscoverableOffersCommand): Promise<OfferListResult> {
    const restaurant = await this.discoveryReader.getRestaurantById(command.restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    return this.listPublicOffersUseCase.execute({
      restaurantId: command.restaurantId,
      page: command.page,
      limit: command.limit,
    });
  }
}
