/**
 * Phase 20.X (ADR-014 execution) - a dedicated BullMQ queue for the
 * grace-period-delayed `User -> Anonymized` transition, mirroring
 * `SubscriptionExpirationQueue`'s one-queue-per-concern precedent exactly.
 */
export const ACCOUNT_DELETION_QUEUE_NAME = 'AccountDeletionQueue';

export const ANONYMIZE_USER_ACCOUNT_JOB_NAME = 'anonymize-user-account';

/**
 * No `organizationId` field, unlike every tenant-scoped BullMQ job payload
 * CODING_STANDARDS.md otherwise requires it on - `User` is not a
 * `DIRECT_TENANT_OWNED_MODEL` and this job never resolves any tenant-scoped
 * repository, so no `TenantContext` needs establishing. Same precedent as
 * `Notification` carrying no `organizationId` (a Customer's account, like
 * their notification inbox, spans every organization they've ever
 * interacted with, not one).
 */
export interface AnonymizeUserAccountJobData {
  userId: string;
  correlationId?: string;
}
