/**
 * CR WJ-R-2026-002 round 2: which Offer (if any) a new reservation may be
 * attributed to. Owned by the Reservations context so it never reaches into
 * the Offers module's repositories; it only answers one yes/no question.
 */
export interface OfferAttributionReaderPort {
  /**
   * Returns `offerId` when that offer belongs to `restaurantId`, is not
   * deleted, is Published, and `at` falls inside its [startsAt, endsAt)
   * window. Returns null otherwise - an unknown, foreign or lapsed offer is
   * simply not recorded, it never blocks the booking itself.
   */
  findAttributableOfferId(offerId: string, restaurantId: string, at: Date): Promise<string | null>;
}

export const OFFER_ATTRIBUTION_READER = Symbol('OFFER_ATTRIBUTION_READER');
