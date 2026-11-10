import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { OfferId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { OfferRepository, OFFER_REPOSITORY } from '../../domain/repositories/offer.repository';
import { OfferNotFoundException } from '../../domain/exceptions/offer-not-found.exception';
import { minutesOf } from '../../domain/policies/offer-conditions.policy';
import {
  OFFER_BASELINE_WEEKS,
  baselineWindowStart,
  estimatedCost,
  liftPercent,
  sharePercent,
  usualBookings,
} from '../../domain/policies/offer-impact.policy';
import { OfferImpactReaderPort, OFFER_IMPACT_READER } from '../ports/offer-impact-reader.port';
import { GetOfferImpactCommand } from '../dto/get-offer-impact.command';
import { OfferImpactResult } from '../dto/offer-impact.result';

/**
 * ADR-047: the impact card on the offers page (Owner/Admin). Views,
 * bookings, persons, new-guest share and visits; bookings in the offer's
 * slots against the usual for those slots; and the estimated discount cost.
 */
@Injectable()
export class GetOfferImpactUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(OFFER_REPOSITORY) private readonly offerRepository: OfferRepository,
    @Inject(OFFER_IMPACT_READER) private readonly impactReader: OfferImpactReaderPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(command: GetOfferImpactCommand): Promise<OfferImpactResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }
    const offer = await this.offerRepository.findByIdAndRestaurantId(
      OfferId.create(command.offerId),
      restaurantId,
    );
    if (offer === null) {
      throw new OfferNotFoundException();
    }

    const now = this.clock.now();
    const from = offer.startsAt;
    const to = new Date(Math.min(offer.endsAt.getTime(), now.getTime()));
    const started = to.getTime() > from.getTime();

    const filter = {
      restaurantId: restaurantId.value,
      branchIds: offer.branchIds,
      daysOfWeek: offer.daysOfWeek,
      fromMinute: offer.startTime === null ? null : minutesOf(offer.startTime),
      toMinute: offer.endTime === null ? null : minutesOf(offer.endTime),
    };

    const [counts, values, during, baseline] = await Promise.all([
      this.impactReader.countOfferBookings(offer.offerId.value),
      this.impactReader.attendedValueByCurrency(offer.offerId.value),
      started ? this.impactReader.countSlotBookings(filter, from, to) : Promise.resolve(0),
      started
        ? this.impactReader.countSlotBookings(filter, baselineWindowStart(from), from)
        : Promise.resolve(0),
    ]);

    const usual = started ? usualBookings(baseline, to.getTime() - from.getTime()) : null;

    return {
      offerId: offer.offerId.value,
      views: offer.viewCount,
      bookings: counts.bookings,
      persons: counts.persons,
      attended: counts.attended,
      newCustomerPercent: sharePercent(counts.newCustomerBookings, counts.bookings),
      comparison: {
        from: started ? from : null,
        to: started ? to : null,
        bookingsInOfferSlots: during,
        usualBookings: usual,
        liftPercent: usual === null ? null : liftPercent(during, usual),
        baselineWeeks: OFFER_BASELINE_WEEKS,
      },
      estimatedCost: estimatedCost(offer.discountType, offer.discountValue, values),
      generatedAt: now,
    };
  }
}
