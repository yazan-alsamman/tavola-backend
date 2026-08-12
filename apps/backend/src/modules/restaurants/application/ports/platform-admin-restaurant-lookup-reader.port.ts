export interface PlatformAdminRestaurantLookup {
  readonly restaurantId: string;
  readonly organizationId: string;
}

export interface RestaurantStatusCounts {
  readonly total: number;
  readonly active: number;
  readonly suspended: number;
  readonly deleted: number;
}

export interface RestaurantLookupRow {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly deletedAt: Date | null;
}

/**
 * ADR-035 Pattern 2 (Tenant-Agnostic Raw Reader) — resolves which
 * Organization owns a given Restaurant id with no tenant identity bound yet,
 * the precondition every PlatformAdmin Restaurant lifecycle use case needs
 * before it can Explicit-Tenant-Rebind (Pattern 1) to mutate through the
 * ordinary tenant-scoped `RestaurantRepository`. `/platform-admin/restaurants/:id/...`
 * only supplies `restaurantId`, unlike the Organization/Subscription routes
 * where `:id` already IS the organizationId.
 *
 * `countByStatus` (Phase 19 — Platform Dashboard composition) reuses this
 * same reader rather than adding a new one: it is already the sole Pattern-2
 * Restaurant reader, and a platform-wide status count has the identical
 * "no single organizationId to bind" shape as the lookup method above.
 * `total`/`active`/`suspended` exclude soft-deleted rows; `deleted` counts
 * them separately (ADR-034 §3 — `RestaurantStatus` remains exactly
 * `{Active, Suspended}`, soft delete is a distinct `deletedAt` axis).
 */
export interface PlatformAdminRestaurantLookupReaderPort {
  findOrganizationIdByRestaurantId(
    restaurantId: string,
  ): Promise<PlatformAdminRestaurantLookup | null>;

  countByStatus(): Promise<RestaurantStatusCounts>;

  /**
   * ADR-034 §13 — narrow, per-entity, indexed-column lookup ("Restaurant...
   * by name/id"), reusing this same Pattern 2 reader rather than adding a
   * new one, same precedent as `countByStatus`. Case-insensitive partial
   * match on `name` OR `slug`, mirroring `PrismaDiscoveryReader`'s own
   * `contains`/`mode: 'insensitive'` convention (ADR-034 §13's explicit
   * "reusing the existing ILIKE-filter pattern Discovery already uses").
   * `q` empty/omitted lists every Restaurant, newest first. Includes
   * soft-deleted rows (a support tool finding a deleted Restaurant is a
   * legitimate use, mirrors `findOrganizationIdByRestaurantId`'s own
   * "Restore needs to find one" precedent).
   */
  search(
    q: string,
    page: number,
    limit: number,
  ): Promise<{ items: RestaurantLookupRow[]; total: number }>;
}

export const PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER = Symbol(
  'PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER',
);
