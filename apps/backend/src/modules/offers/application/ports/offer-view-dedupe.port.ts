/**
 * ADR-048: an offer counts one view per viewer per UTC day, so reloading the
 * list or paging back and forth does not inflate the impact card.
 */
export interface OfferViewDedupePort {
  /** Returns the ids among `offerIds` this viewer has not been counted for today, and marks them. */
  claimFirstViews(offerIds: string[], viewerKey: string, now: Date): Promise<string[]>;
}

export const OFFER_VIEW_DEDUPE = Symbol('OFFER_VIEW_DEDUPE');
