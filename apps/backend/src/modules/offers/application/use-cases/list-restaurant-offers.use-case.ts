import { Injectable, Inject } from '@nestjs/common';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { OfferRepository, OFFER_REPOSITORY } from '../../domain/repositories/offer.repository';
import { toOfferResult } from '../mappers/offer-result.mapper';
import { ListRestaurantOffersCommand } from '../dto/list-restaurant-offers.command';
import { OfferListResult } from '../dto/offer-list.result';

/**
 * Phase 11 (Offers, architecture frozen 2026-07-28) - the Owner/Admin
 * management listing: every status (Draft/Published/Expired), paginated,
 * newest-created first. Never confused with the public listing
 * (`ListPublicOffersUseCase`), which lives on a different route
 * (`/discovery/restaurants/:restaurantId/offers`) precisely to avoid a
 * same-path GET collision with this one.
 */
@Injectable()
export class ListRestaurantOffersUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(OFFER_REPOSITORY) private readonly offerRepository: OfferRepository,
  ) {}

  async execute(command: ListRestaurantOffersCommand): Promise<OfferListResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const page = await this.offerRepository.findManyByRestaurantId(
      restaurantId,
      command.page,
      command.limit,
    );
    return {
      items: page.items.map(toOfferResult),
      page: command.page,
      limit: command.limit,
      total: page.total,
    };
  }
}
