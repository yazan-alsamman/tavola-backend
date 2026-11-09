import { OfferDiscountType, OfferStatus, OfferType } from '../../domain/enums/offer.enums';

/** Explicit field allowlist - identical shape for management and public reads (never `deletedAt`). */
export interface OfferResult {
  offerId: string;
  restaurantId: string;
  type: OfferType;
  title: string;
  description: string;
  discountType: OfferDiscountType;
  discountValue: number;
  startsAt: Date;
  endsAt: Date;
  status: OfferStatus;
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  minPartySize: number | null;
  branchIds: string[];
  oncePerCustomer: boolean;
  bookingCap: number | null;
  createdAt: Date;
  updatedAt: Date;
}
