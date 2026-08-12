/**
 * Phase 19.9 (ADR-037) — reuses the existing `NotificationQueue` (no new
 * queue system, per the approved scope's "extend, don't duplicate, queue
 * infrastructure" instruction). This is a second job NAME on the same queue,
 * not a second queue.
 */
export const NOTIFICATION_BROADCAST_FANOUT_JOB_NAME = 'fanout-notification-broadcast';

/** Mirrors `NOTIFICATION_PUSH_MAX_ATTEMPTS`'s exact rationale/value - no Dead Letter Queue in v1. */
export const NOTIFICATION_BROADCAST_MAX_ATTEMPTS = 5;

/** Keyset page size per DB round trip - never `OFFSET` (CODING_STANDARDS.md's N+1/scale rule). */
export const NOTIFICATION_BROADCAST_BATCH_SIZE = 500;

/**
 * Upper bound on how many batches ONE job execution processes before
 * self-enqueuing a continuation job, so a single run's wall-clock time and
 * memory stay bounded regardless of total audience size (approved scope §11:
 * "Do not create an unbounded for-each-user loop inside one job").
 * 5 * 500 = 2,500 Notification rows/realtime batches per run.
 */
export const NOTIFICATION_BROADCAST_BATCHES_PER_RUN = 5;

/**
 * `Notification`/`NotificationBroadcast` carry no `organizationId` (ADR-037
 * Decision #4 - the audience is global) - like `NotificationDeliveryJobData`,
 * this job data deliberately omits it; there is no `TenantContext` to
 * establish.
 */
export interface NotificationBroadcastFanoutJobData {
  broadcastId: string;
  correlationId?: string;
}
