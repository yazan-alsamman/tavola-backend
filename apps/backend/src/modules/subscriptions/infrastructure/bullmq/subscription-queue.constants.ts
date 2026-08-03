/**
 * Phase 12 (Subscriptions, architecture frozen 2026-07-28, ADR-027) - a
 * dedicated BullMQ queue for the `Active -> Expired` transition, mirroring
 * `OfferExpirationQueue`'s own one-queue-per-concern precedent. Not a
 * monthly-reset queue - D17 override eliminated period-based limits
 * entirely, so no such queue exists anywhere in this module.
 */
export const SUBSCRIPTION_EXPIRATION_QUEUE_NAME = 'SubscriptionExpirationQueue';

export const EXPIRE_SUBSCRIPTION_JOB_NAME = 'expire-subscription';

/** CODING_STANDARDS.md: "Job payloads must always include `organizationId` explicitly." */
export interface ExpireSubscriptionJobData {
  subscriptionId: string;
  organizationId: string;
  correlationId?: string;
}
