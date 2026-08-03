import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { OfferRepository, OFFER_REPOSITORY } from '../../domain/repositories/offer.repository';
import { toOfferResult } from '../mappers/offer-result.mapper';
import { ListPublicOffersCommand } from '../dto/list-public-offers.command';
import { OfferListResult } from '../dto/offer-list.result';

/**
 * Phase 11 (Offers, architecture frozen 2026-07-28), owner decision D5: the
 * sole authority for "active public Offers" - `status = Published AND
 * startsAt <= now AND endsAt > now AND deletedAt IS NULL`
 * (`OfferRepository.findManyPublicByRestaurantId`'s own `WHERE` clause).
 * Deliberately takes no actor and performs no restaurant-visibility check
 * of its own - `DiscoveryModule`'s `ListDiscoverableOffersUseCase` composes
 * this with `DiscoveryReaderPort.getRestaurantById` for that (task
 * instructions §6: "OfferRepository / Offer application services must
 * remain authoritative for Offer rules... keep Discovery compositional").
 * The restaurant-scoped Owner/Admin management surface
 * (`OffersController`) does not call this use case at all - it always sees
 * every status via `ListRestaurantOffersUseCase`.
 */
@Injectable()
export class ListPublicOffersUseCase {
  constructor(
    @Inject(OFFER_REPOSITORY) private readonly offerRepository: OfferRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(command: ListPublicOffersCommand): Promise<OfferListResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);
    const now = this.clock.now();
    const page = await this.offerRepository.findManyPublicByRestaurantId(
      restaurantId,
      now,
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
