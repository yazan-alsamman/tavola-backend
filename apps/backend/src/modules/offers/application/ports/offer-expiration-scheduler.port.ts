/**
 * Phase 11 (Offers, architecture frozen 2026-07-28) - schedules/cancels the
 * BullMQ delayed job that transitions a `Published` Offer to `Expired` at
 * its `endsAt`, mirroring `ReservationExpirationSchedulerPort`/
 * `LateArrivalQueue`'s own shape exactly. CODING_STANDARDS.md requires every
 * BullMQ job payload to carry `organizationId` explicitly so the job handler
 * can establish Tenant Context as its first line, even though the Offer
 * write itself needs no tenant scoping (not a `DIRECT_TENANT_OWNED_MODEL`).
 */
export interface OfferExpirationSchedulerPort {
  /** Schedules (or re-schedules, replacing any existing job for the same Offer) a delayed job to fire at `expireAt`. */
  scheduleExpiration(
    offerId: string,
    organizationId: string,
    expireAt: Date,
    correlationId?: string,
  ): Promise<void>;

  /**
   * Removes any pending delayed job for this Offer - called when it is
   * soft-deleted before its own expiration job would otherwise fire. A safe
   * no-op if no job exists.
   */
  cancelExpiration(offerId: string): Promise<void>;
}

export const OFFER_EXPIRATION_SCHEDULER = Symbol('OFFER_EXPIRATION_SCHEDULER');
