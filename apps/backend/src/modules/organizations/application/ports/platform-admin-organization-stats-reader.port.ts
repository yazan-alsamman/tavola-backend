export interface OrganizationStatusCounts {
  readonly total: number;
  readonly active: number;
  readonly suspended: number;
  readonly deleted: number;
}

export interface OrganizationLookupRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly deletedAt: Date | null;
}

/**
 * Mirrors `RestaurantLookupStatusFilter` exactly — one filter spanning the
 * `status` column and the separate soft-delete axis, since "show me the
 * deleted ones" is the question a support console actually asks.
 *
 * `Closed` is deliberately absent even though `OrganizationStatus` declares
 * it: ADR-034 §4/§5 records it as an unused, undocumented value no
 * PlatformAdmin action ever writes, and the Dashboard's own status counts
 * already exclude it for that reason. Offering it as a filter would present
 * a dead value as though it were real data. Omitting the filter preserves
 * the existing behaviour: every Organization, soft-deleted rows included.
 */
export type OrganizationLookupStatusFilter = 'Active' | 'Suspended' | 'Deleted';

export interface OrganizationLookupQuery {
  /**
   * Case-insensitive partial match on name or slug. Empty or whitespace-only
   * means "no text filter" and returns the ordinary paginated list — never an
   * empty result, and never a `LIKE '%%'` scan.
   */
  readonly q: string;
  readonly status?: OrganizationLookupStatusFilter;
  readonly page: number;
  readonly limit: number;
}

/**
 * Everything the Platform Owner organization-detail view renders.
 * `restaurantCount`/`memberCount` are aggregated in the same round trip as
 * the row itself, so the console does not have to issue follow-up calls (and
 * cannot render a count from a different instant than the record).
 */
export interface OrganizationDetailRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly billingEmail: string;
  readonly restaurantCount: number;
  readonly memberCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

/**
 * ADR-035 Pattern 2 (Tenant-Agnostic Raw Reader) — Phase 19 Platform
 * Dashboard composition. No single `organizationId` can be bound for a
 * platform-wide Organization count, the same "genuinely cross-tenant read"
 * shape as `PlatformAdminRestaurantLookupReaderPort.countByStatus` and
 * `AcquisitionCrossTenantReaderPort`. Mirrors those readers' precedent
 * rather than reusing the existing tenant-scoped `OrganizationRepository`
 * (which has no cross-org read capability by design — TENANCY.md).
 *
 * `OrganizationStatus.Closed` (ADR-034 §4/§5's "unused, undocumented enum
 * value... deliberately left untouched, not repurposed") is deliberately
 * excluded from this count — it is not a state PlatformAdmin ever writes,
 * so surfacing it on the Dashboard would present a dead value as if it were
 * real data. `total`/`active`/`suspended` exclude soft-deleted rows;
 * `deleted` counts them separately (same shape as Restaurant).
 */
export interface PlatformAdminOrganizationStatsReaderPort {
  countByStatus(): Promise<OrganizationStatusCounts>;

  /**
   * ADR-034 §13 — narrow, per-entity, indexed-column lookup ("Organization
   * ... by name/id"), reusing this same Pattern 2 reader rather than adding
   * a new one, same precedent as `countByStatus`. Case-insensitive partial
   * match on `name` OR `slug`, mirroring the Discovery `contains`/
   * `mode: 'insensitive'` convention. `q` empty/omitted lists every
   * Organization, newest first. Includes soft-deleted rows.
   */
  search(
    query: OrganizationLookupQuery,
  ): Promise<{ items: OrganizationLookupRow[]; total: number }>;

  /**
   * Full detail for one Organization, backing
   * `GET /platform-admin/organizations/:id`. Soft-deleted Organizations are
   * returned rather than treated as missing — Restore needs to be able to
   * inspect one first, the same precedent `search` already follows.
   */
  findDetailById(organizationId: string): Promise<OrganizationDetailRow | null>;
}

export const PLATFORM_ADMIN_ORGANIZATION_STATS_READER = Symbol(
  'PLATFORM_ADMIN_ORGANIZATION_STATS_READER',
);
