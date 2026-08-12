export interface NotificationPushStatusCounts {
  readonly total: number;
  readonly notAttempted: number;
  readonly queued: number;
  readonly accepted: number;
  readonly failed: number;
}

/**
 * ADR-035 Pattern 2 (Tenant-Agnostic Raw Reader) — Phase 19.6, closing the
 * Messaging dependency Phase 19.5's Dashboard composition disclosed as
 * unimplemented. `Notification` carries no `organizationId`/`restaurantId`
 * at all (TENANCY.md: "Customer-owned models that legitimately span
 * multiple organizations... carry no direct organizationId") — a
 * platform-wide `pushStatus` count therefore has no single tenant to bind,
 * the identical shape as `PlatformAdminOrganizationStatsReaderPort`/
 * `PlatformAdminSubscriptionStatsReaderPort`.
 *
 * Deliberately a current-state snapshot, not a date-ranged time-series:
 * `pushStatus` is a per-row current-state field (a notification's delivery
 * status right now), not a time-bucketed metric like Acquisition/Revenue —
 * there is no existing frozen date-range contract for Notification
 * reporting to reuse, and inventing one would contradict the "implement the
 * minimum contract necessary" instruction this phase was scoped under.
 */
export interface PlatformAdminNotificationStatsReaderPort {
  countByPushStatus(): Promise<NotificationPushStatusCounts>;
}

export const PLATFORM_ADMIN_NOTIFICATION_STATS_READER = Symbol(
  'PLATFORM_ADMIN_NOTIFICATION_STATS_READER',
);
