export interface SubscriptionStatusCounts {
  readonly total: number;
  readonly active: number;
  readonly suspended: number;
  readonly cancelled: number;
  readonly expired: number;
}

/**
 * ADR-035 Pattern 2 (Tenant-Agnostic Raw Reader) — Phase 19 Platform
 * Dashboard composition. `SubscriptionRepository` is entirely tenant-scoped
 * (single-organization lookups only, by design — ADR-027), so a
 * platform-wide count-by-status has no existing capability to reuse and no
 * single `organizationId` to Explicit-Tenant-Rebind to. Mirrors
 * `PlatformAdminOrganizationStatsReaderPort`'s identical shape. `Subscription`
 * carries no `deletedAt` (entitlement contracts are never soft-deleted —
 * `Cancelled`/`Expired` are the terminal states), so `total` is simply the
 * sum of all four statuses.
 */
export interface PlatformAdminSubscriptionStatsReaderPort {
  countByStatus(): Promise<SubscriptionStatusCounts>;
}

export const PLATFORM_ADMIN_SUBSCRIPTION_STATS_READER = Symbol(
  'PLATFORM_ADMIN_SUBSCRIPTION_STATS_READER',
);
