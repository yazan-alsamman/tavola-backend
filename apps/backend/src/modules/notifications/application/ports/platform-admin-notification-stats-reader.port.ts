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
/**
 * One persisted `NotificationBroadcast` row, exactly as the fan-out
 * processor left it. Every field here is real backend state — `status` is the
 * aggregate's own `Pending -> Processing -> {Completed | Failed}` machine,
 * and the three counters are written per batch by
 * `NotificationBroadcast.recordBatch`. Nothing is synthesized or inferred at
 * read time, so a console rendering "was this actually sent?" is reading the
 * truth rather than a display-layer guess.
 */
export interface NotificationBroadcastHistoryRow {
  readonly id: string;
  readonly senderType: string;
  readonly senderId: string;
  readonly organizationId: string | null;
  readonly title: string;
  readonly body: string;
  /** Point-in-time audience snapshot taken at queue time; null until resolved. */
  readonly totalRecipients: number | null;
  readonly processedCount: number;
  readonly succeededCount: number;
  readonly failedCount: number;
  readonly status: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NotificationBroadcastHistoryQuery {
  /** Filters on the persisted `NotificationBroadcastStatus`. */
  readonly status?: string;
  /** Filters on the persisted `NotificationBroadcastSenderType`. */
  readonly senderType?: string;
  readonly page: number;
  readonly limit: number;
}

export interface PlatformAdminNotificationStatsReaderPort {
  countByPushStatus(): Promise<NotificationPushStatusCounts>;

  /**
   * Broadcast history, newest first, backing `GET /platform-admin/notifications`.
   *
   * `NotificationBroadcastRepository`'s own doc comment records that no
   * listing method existed "in v1 (no admin UI to browse past broadcasts was
   * authorized)". One is authorized now, and this is where it lands: a
   * Pattern-2 read on the same reader that already owns platform-wide
   * Notification aggregates, rather than a listing method on the
   * tenant-facing repository, which exists to load one aggregate for the
   * fan-out processor to mutate. Read and write paths stay separate.
   *
   * Both sender types are included — a Platform Owner auditing outbound
   * messaging needs to see Restaurant Owner broadcasts too, and
   * `senderType` is available as a filter for when they do not.
   */
  listBroadcasts(
    query: NotificationBroadcastHistoryQuery,
  ): Promise<{ items: NotificationBroadcastHistoryRow[]; total: number }>;
}

export const PLATFORM_ADMIN_NOTIFICATION_STATS_READER = Symbol(
  'PLATFORM_ADMIN_NOTIFICATION_STATS_READER',
);
