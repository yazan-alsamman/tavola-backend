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
    q: string,
    page: number,
    limit: number,
  ): Promise<{ items: OrganizationLookupRow[]; total: number }>;
}

export const PLATFORM_ADMIN_ORGANIZATION_STATS_READER = Symbol(
  'PLATFORM_ADMIN_ORGANIZATION_STATS_READER',
);
