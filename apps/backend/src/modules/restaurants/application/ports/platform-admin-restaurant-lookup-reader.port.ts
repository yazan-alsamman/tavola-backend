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
 * The lifecycle state a Platform Owner filters a Restaurant list by. Not the
 * same axis as `RestaurantStatus` (which is exactly `{Active, Suspended}`):
 * `Deleted` here means `deletedAt IS NOT NULL`, the separate soft-delete
 * axis ADR-034 §3 keeps distinct from `status`. Flattening the two into one
 * filter is what a support console actually needs — "show me the deleted
 * ones" is a question about the row, not about its status column — and it
 * avoids forcing callers to combine two parameters to express one intent.
 *
 * Omitting the filter preserves the existing behaviour exactly: every
 * Restaurant, soft-deleted rows included.
 */
export type RestaurantLookupStatusFilter = 'Active' | 'Suspended' | 'Deleted';

export interface RestaurantLookupQuery {
  /**
   * Case-insensitive partial match on name or slug. Empty or whitespace-only
   * means "no text filter" and returns the ordinary paginated list — never
   * an empty result, and never a `LIKE '%%'` scan.
   */
  readonly q: string;
  readonly status?: RestaurantLookupStatusFilter;
  readonly page: number;
  readonly limit: number;
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
  search(query: RestaurantLookupQuery): Promise<{ items: RestaurantLookupRow[]; total: number }>;

  /**
   * Full detail for one Restaurant, backing
   * `GET /platform-admin/restaurants/:id`. Same Pattern-2 justification as
   * every other method here — a Platform Owner supplies only a
   * `restaurantId`, with no tenant identity bound, so this cannot go through
   * the tenant-scoped `RestaurantRepository`.
   *
   * Returns a soft-deleted Restaurant rather than `null` (the console must be
   * able to inspect one before deciding to Restore it, the same reason
   * `findOrganizationIdByRestaurantId` includes them), and joins the owning
   * Organization's name/slug so the console need not issue a second call
   * purely to render "which org owns this".
   */
  findDetailById(restaurantId: string): Promise<RestaurantDetailRow | null>;
}

/**
 * Everything the Platform Owner restaurant-detail view renders. A superset
 * of `RestaurantLookupRow` plus the owning Organization — deliberately not a
 * reuse of the tenant-facing `RestaurantResponseDto`, which is shaped for an
 * Owner looking at their own restaurant and carries no cross-tenant context.
 */
export interface RestaurantDetailRow {
  readonly id: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly organizationSlug: string;
  readonly organizationStatus: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly cuisineType: string | null;
  readonly priceLevel: number | null;
  readonly averageRating: number | null;
  readonly logoId: string | null;
  readonly coverImageId: string | null;
  readonly status: string;
  readonly branchCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

export const PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER = Symbol(
  'PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER',
);
