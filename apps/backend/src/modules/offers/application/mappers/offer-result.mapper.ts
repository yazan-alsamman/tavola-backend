import { Offer } from '../../domain/entities/offer.entity';
import { OfferResult } from '../dto/offer.result';

/** `at` given: report the status as of that instant (see `Offer.statusAt`). */
export function toOfferResult(offer: Offer, at?: Date): OfferResult {
  return {
    offerId: offer.offerId.value,
    restaurantId: offer.restaurantId.value,
    type: offer.type,
    title: offer.title,
    description: offer.description,
    discountType: offer.discountType,
    discountValue: offer.discountValue,
    startsAt: offer.startsAt,
    endsAt: offer.endsAt,
    status: at ? offer.statusAt(at) : offer.status,
    createdAt: offer.createdAt,
    updatedAt: offer.updatedAt,
  };
}
