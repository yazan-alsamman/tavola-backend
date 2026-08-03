/**
 * Phase 12 (Subscriptions, ADR-027) - schedules/cancels the BullMQ delayed
 * job that transitions an `Active` Subscription to `Expired` at its
 * `endsAt`, mirroring `OfferExpirationSchedulerPort` exactly.
 * CODING_STANDARDS.md requires every BullMQ job payload to carry
 * `organizationId` explicitly.
 */
export interface SubscriptionExpirationSchedulerPort {
  /** Schedules (or re-schedules, replacing any existing job for the same Subscription) a delayed job to fire at `expireAt`. */
  scheduleExpiration(
    subscriptionId: string,
    organizationId: string,
    expireAt: Date,
    correlationId?: string,
  ): Promise<void>;

  /** Removes any pending delayed job - called when `endsAt` is cleared/changed (plan change, reassignment). A safe no-op if no job exists. */
  cancelExpiration(subscriptionId: string): Promise<void>;
}

export const SUBSCRIPTION_EXPIRATION_SCHEDULER = Symbol('SUBSCRIPTION_EXPIRATION_SCHEDULER');
