/**
 * Phase 9 (Notification System, architecture frozen 2026-07-25, TASKS.md's
 * "Phase 9 — Notification System: Pre-implementation architecture decisions",
 * decision item 5). Two independent tracks on one `Notification` row: `read`/
 * `readAt` (this enum has no bearing on that track) and this push track,
 * `NotAttempted -> Queued -> {Accepted | Failed}`. Both `Accepted`/`Failed`
 * are terminal AS PERSISTED VALUES - the row receives at most one terminal
 * write (EVENTS.md's Notification Events section: "a successful BullMQ retry
 * after an intermediate failure updates the row directly to Accepted, once -
 * per-attempt detail is BullMQ's own job log, not the domain's concern").
 * There is deliberately no `Delivered` value - OneSignal's synchronous Send
 * API only proves provider acceptance, never on-device delivery.
 */
export enum NotificationPushStatus {
  NotAttempted = 'NotAttempted',
  Queued = 'Queued',
  Accepted = 'Accepted',
  Failed = 'Failed',
}

/**
 * `SMS` is documented schema foresight only (NON_FUNCTIONAL_REQUIREMENTS.md)
 * - no SMS template content or delivery code exists in Phase 9 v1. `Email` is
 * permanently out of scope (2026-07-25 product decision, TASKS.md) and is
 * deliberately not a member of this enum.
 */
export enum NotificationChannel {
  Push = 'Push',
  InApp = 'InApp',
  SMS = 'SMS',
}
