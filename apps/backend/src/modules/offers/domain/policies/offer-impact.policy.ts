import { OfferDiscountType } from '../enums/offer.enums';

/**
 * ADR-047 (CR "impact card"): how an offer's results are read.
 * - "Usual" = bookings in the offer's days, hours and branches during the
 *   four weeks before it started, scaled to the time it has run so far.
 * - Estimated cost = attended persons x branch reference price x discount %
 *   for a percentage offer; attended bookings x amount for a fixed one.
 */
export const OFFER_BASELINE_WEEKS = 4;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function baselineWindowStart(startsAt: Date): Date {
  return new Date(startsAt.getTime() - OFFER_BASELINE_WEEKS * WEEK_MS);
}

/** The baseline count scaled to `elapsedMs` of the offer, one decimal. */
export function usualBookings(baselineCount: number, elapsedMs: number): number {
  const scaled = (baselineCount * elapsedMs) / (OFFER_BASELINE_WEEKS * WEEK_MS);
  return Math.round(scaled * 10) / 10;
}

/** Whole-percent change over the usual; null when there is nothing usual to compare with. */
export function liftPercent(actual: number, usual: number): number | null {
  if (usual <= 0) {
    return null;
  }
  return Math.round(((actual - usual) / usual) * 100);
}

export function sharePercent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

export interface AttendedValue {
  currency: string | null;
  attendedBookings: number;
  personsTimesReferencePrice: number;
  unpricedPersons: number;
}

export interface EstimatedCost {
  currency: string | null;
  amount: number;
  /** Some visits had no branch reference price yet, so the amount is low. */
  partial: boolean;
}

export function estimatedCost(
  discountType: OfferDiscountType,
  discountValue: number,
  values: AttendedValue[],
): EstimatedCost[] {
  return values
    .filter((value) => value.attendedBookings > 0)
    .map((value) => {
      const raw =
        discountType === OfferDiscountType.Percentage
          ? (value.personsTimesReferencePrice * discountValue) / 100
          : value.attendedBookings * discountValue;
      return {
        currency: value.currency,
        amount: Math.round(raw * 100) / 100,
        partial: discountType === OfferDiscountType.Percentage && value.unpricedPersons > 0,
      };
    });
}
