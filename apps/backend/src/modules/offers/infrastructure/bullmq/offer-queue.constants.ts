/**
 * Phase 11 (Offers, architecture frozen 2026-07-28) - a dedicated BullMQ
 * queue for the `Published -> Expired` transition, mirroring
 * `ReservationQueue`/`LateArrivalQueue`'s own one-queue-per-concern
 * precedent rather than sharing an existing queue.
 */
export const OFFER_EXPIRATION_QUEUE_NAME = 'OfferExpirationQueue';

export const EXPIRE_OFFER_JOB_NAME = 'expire-offer';

/**
 * CODING_STANDARDS.md: "Job payloads must always include `organizationId`
 * explicitly." Always present (unlike Reservation's Customer-created case) -
 * every Offer is Restaurant-owned, and only Owner/Admin actors (who always
 * carry an `organizationId`) can ever publish one.
 */
export interface ExpireOfferJobData {
  offerId: string;
  organizationId: string;
  correlationId?: string;
}
