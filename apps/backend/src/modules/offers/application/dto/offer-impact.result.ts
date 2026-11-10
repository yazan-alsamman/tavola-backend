import { EstimatedCost } from '../../domain/policies/offer-impact.policy';

export interface OfferImpactResult {
  offerId: string;
  views: number;
  bookings: number;
  persons: number;
  attended: number;
  newCustomerPercent: number | null;
  comparison: {
    /** The part of the offer period that has run, or null before it starts. */
    from: Date | null;
    to: Date | null;
    bookingsInOfferSlots: number;
    usualBookings: number | null;
    liftPercent: number | null;
    baselineWeeks: number;
  };
  estimatedCost: EstimatedCost[];
  generatedAt: Date;
}
