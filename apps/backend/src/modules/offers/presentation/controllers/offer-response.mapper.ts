import { OfferResult } from '../../application/dto/offer.result';
import { OfferListResult } from '../../application/dto/offer-list.result';
import { OfferResponseDto } from '../dto/offer.response.dto';
import { OfferListResponseDto } from '../dto/offer-list.response.dto';

export function toOfferResponse(result: OfferResult): OfferResponseDto {
  return {
    offerId: result.offerId,
    restaurantId: result.restaurantId,
    type: result.type,
    title: result.title,
    description: result.description,
    discountType: result.discountType,
    discountValue: result.discountValue,
    startsAt: result.startsAt.toISOString(),
    endsAt: result.endsAt.toISOString(),
    status: result.status,
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
  };
}

export function toOfferListResponse(result: OfferListResult): OfferListResponseDto {
  return {
    items: result.items.map(toOfferResponse),
    page: result.page,
    limit: result.limit,
    total: result.total,
  };
}
