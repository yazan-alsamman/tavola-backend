import { Offer } from '../../domain/entities/offer.entity';
import { OfferResult } from '../dto/offer.result';

export function toOfferResult(offer: Offer): OfferResult {
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
    status: offer.status,
    createdAt: offer.createdAt,
    updatedAt: offer.updatedAt,
  };
}
