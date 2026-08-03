import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { OfferRepository, OFFER_REPOSITORY } from '../../domain/repositories/offer.repository';

export interface ListRestaurantIdsWithActiveOfferCommand {
  restaurantIds: string[];
}

/**
 * Phase 15.5 (Discovery Module, architecture frozen 2026-07-29, D9): sole
 * authority for "which of these restaurants currently have at least one
 * public-active Offer" - reuses `OfferRepository.findRestaurantIdsWithActivePublicOffer`,
 * the same bulk form of the exact predicate `ListPublicOffersUseCase` already
 * owns (`status = Published AND startsAt <= now < endsAt AND deletedAt IS
 * NULL`). Deliberately takes no actor and performs no restaurant-visibility
 * check of its own - callers (Discovery's search/nearby/compare use cases)
 * already resolved visibility before calling this, exactly like
 * `ListDiscoverableOffersUseCase` composes `ListPublicOffersUseCase`.
 */
@Injectable()
export class ListRestaurantIdsWithActiveOfferUseCase {
  constructor(
    @Inject(OFFER_REPOSITORY) private readonly offerRepository: OfferRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(command: ListRestaurantIdsWithActiveOfferCommand): Promise<Set<string>> {
    if (command.restaurantIds.length === 0) {
      return new Set();
    }
    const restaurantIds = command.restaurantIds.map((id) => RestaurantId.create(id));
    return this.offerRepository.findRestaurantIdsWithActivePublicOffer(
      restaurantIds,
      this.clock.now(),
    );
  }
}
