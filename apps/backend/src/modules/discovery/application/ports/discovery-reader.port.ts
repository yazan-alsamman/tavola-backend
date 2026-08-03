import { RestaurantResult } from '@modules/restaurants/application/dto/restaurant.result';
import { BranchResult } from '@modules/branches/application/dto/branch.result';
import { FloorPlanResult } from '@modules/tables/application/dto/floor-plan.result';
import { TableResult } from '@modules/tables/application/dto/table.result';

export interface DiscoveryListPage<T> {
  items: T[];
  total: number;
}

/**
 * Phase 15.5 (Discovery Module, architecture frozen 2026-07-29, D5/D6/D7/D14):
 * optional filters shared by plain search (`listRestaurants`) and nearby
 * search (`searchNearby`). `q` matches `ILIKE '%q%'` against `Restaurant.name`
 * only (no description, no `cuisineType` - D5/D6); `cuisineId`/`occasionId`
 * filter via the relational taxonomy join tables, never the legacy
 * `Restaurant.cuisineType` string column.
 */
export interface DiscoverableRestaurantFilters {
  q?: string;
  cuisineId?: string;
  occasionId?: string;
  priceLevel?: number;
  minRating?: number;
  city?: string;
}

export type DiscoverableRestaurantSort = 'name' | 'rating' | 'newest';
export type SortOrder = 'asc' | 'desc';

export interface ListRestaurantsParams extends DiscoverableRestaurantFilters {
  page: number;
  limit: number;
  sort?: DiscoverableRestaurantSort;
  order?: SortOrder;
}

export interface NearbySearchParams extends DiscoverableRestaurantFilters {
  lat: number;
  lng: number;
  radiusKm: number;
  page: number;
  limit: number;
}

/**
 * A Restaurant result annotated with the nearest qualifying Branch's id and
 * exact-refined distance (D2/D4: Restaurant-rooted, deduplicated - never one
 * row per matching Branch).
 */
export interface NearbyRestaurantResult extends RestaurantResult {
  nearestBranchId: string;
  distanceKm: number;
}

/**
 * Phase 15.5 (Discovery Module, architecture frozen 2026-07-29) extends the
 * Customer Restaurant Discovery & Public Read Surface (2026-07-28) - minimal,
 * read-only, cross-tenant lookup of publicly-discoverable Restaurant/Branch/
 * FloorPlan/Table fields, owned by this bounded context, not a full
 * Restaurants/Branches/Tables repository. Required because discovery is
 * public/unauthenticated (ADR-018 §4 "Search/nearby endpoints are public"):
 * there is no bound `TenantContext.organizationId` to scope by, but
 * `Restaurant`/`Branch`/`FloorPlan`/`Table` are all tenant-owned (directly or
 * transitively) under `withTenantScoping` - a query through the standard
 * tenant-scoped `PrismaContext` client with no bound context throws
 * `TenantContextMissingException` by design (TENANCY.md fail-closed
 * behavior). See `PrismaDiscoveryReader` for why this is not a
 * `$systemContext` use (TENANCY.md restricts that escape hatch to
 * platform-admin/analytics/support tooling, never a feature module) and
 * instead follows the `RestaurantDirectoryReaderPort`/
 * `PrismaLoginOrganizationReader` precedent exactly (Phase 3.3).
 *
 * Every returned Result type is already the exact customer-safe shape the
 * existing management endpoints already return (no `organizationId`, no
 * internal/administrative field was ever present on these Result
 * interfaces to begin with) - reused verbatim, not duplicated.
 */
export interface DiscoveryReaderPort {
  listRestaurants(params: ListRestaurantsParams): Promise<DiscoveryListPage<RestaurantResult>>;

  /** Returns `null` for unknown, soft-deleted, or non-`Active` restaurants. */
  getRestaurantById(restaurantId: string): Promise<RestaurantResult | null>;

  /**
   * Phase 15.5 (D6/D18/D19 - Comparison API): returns only the subset of
   * `restaurantIds` that resolve to a publicly-visible (`Active`, non-deleted)
   * restaurant. Order is not guaranteed - the caller re-orders per the
   * caller-requested id order.
   */
  getRestaurantsByIds(restaurantIds: string[]): Promise<RestaurantResult[]>;

  /**
   * Phase 15.5 (D2/D4/D11-adjacent geo instructions): bounding-box prefilter
   * (existing `(latitude, longitude)` B-tree index) refined by an exact
   * Haversine distance calculation, Restaurant-deduplicated (nearest
   * qualifying Branch wins), ordered `distance ASC` then `restaurantId ASC`.
   * A Branch with a `NULL` `latitude`/`longitude` never qualifies.
   */
  searchNearby(params: NearbySearchParams): Promise<DiscoveryListPage<NearbyRestaurantResult>>;

  listBranchesByRestaurantId(
    restaurantId: string,
    page: number,
    limit: number,
  ): Promise<DiscoveryListPage<BranchResult>>;

  /** Returns `null` unless the branch belongs to `restaurantId` and is not soft-deleted. */
  getBranchById(branchId: string, restaurantId: string): Promise<BranchResult | null>;

  /** Returns `null` if the branch has no active, non-soft-deleted FloorPlan. */
  getActiveFloorPlanByBranchId(branchId: string): Promise<FloorPlanResult | null>;

  /** Ordered by `tableNumber` ascending; excludes soft-deleted tables. */
  listTablesByFloorPlanId(floorPlanId: string): Promise<TableResult[]>;
}

export const DISCOVERY_READER = Symbol('DISCOVERY_READER');
