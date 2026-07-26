/**
 * Phase 9 (architecture frozen 2026-07-25, TASKS.md decision item 10,
 * queue name reserved since Phase 7.6's `EVENTS.md`). `NotificationQueue`
 * owns Push delivery only - explicitly separate from
 * `ReminderQueue`/`LateArrivalQueue` (Phase 7.6), which own only scheduling
 * and are never modified to call `NotificationProvider` directly.
 */
export const NOTIFICATION_QUEUE_NAME = 'NotificationQueue';

export const NOTIFICATION_DELIVERY_JOB_NAME = 'deliver-notification-push';

/**
 * Decision item 9: exact retry count/backoff is explicitly left as an
 * implementation detail, not frozen. `5` is chosen to reconcile with
 * `NON_FUNCTIONAL_REQUIREMENTS.md`'s generic background-job "Maximum
 * retries: 5" guidance - no Dead Letter Queue is built (decision item 9
 * explicitly forbids one in v1); after this many attempts the terminal
 * outcome is written `Failed` and no further retry is attempted.
 */
export const NOTIFICATION_PUSH_MAX_ATTEMPTS = 5;

/**
 * `Notification` carries no `organizationId` (decision item 13) - unlike
 * every other job-data interface in this codebase (which always carries
 * `organizationId: string | null` per `CODING_STANDARDS.md`, for
 * `TenantContext` establishment), this queue's jobs deliberately omit it:
 * `Notification` is never tenant-scoped, so there is no `TenantContext` for
 * `ProcessNotificationDeliveryUseCase` to establish.
 */
export interface NotificationDeliveryJobData {
  notificationId: string;
  correlationId?: string;
}
