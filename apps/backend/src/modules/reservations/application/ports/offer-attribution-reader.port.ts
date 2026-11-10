/**
 * CR WJ-R-2026-002 round 2: which Offer (if any) a new reservation may be
 * attributed to. Owned by the Reservations context so it never reaches into
 * the Offers module's repositories; it only answers one yes/no question.
 */
export interface OfferAttributionBooking {
  branchId: string;
  partySize: number;
  /** The visit's start (UTC instant). */
  startTime: Date;
  /** The branch's IANA zone: offer days and hours are branch-local. */
  timeZone: string;
  /** The app user booking, or null for a guest booked by staff. */
  userId: string | null;
  /** The staff-booked guest's phone, or null. */
  guestPhone: string | null;
}

export interface OfferAttributionReaderPort {
  /**
   * Returns `offerId` when that offer belongs to `restaurantId`, is not
   * deleted, is Published and live at `at`, and the booking meets its
   * conditions (ADR-047): visit inside the period, on its days and hours,
   * at one of its branches, with enough guests, under the booking cap, and
   * - when once-per-customer - the guest's first booking with it. Returns
   * null otherwise - an offer that does not apply is simply not recorded,
   * it never blocks the booking itself.
   */
  findAttributableOfferId(
    offerId: string,
    restaurantId: string,
    at: Date,
    booking: OfferAttributionBooking,
  ): Promise<string | null>;
}

export const OFFER_ATTRIBUTION_READER = Symbol('OFFER_ATTRIBUTION_READER');
