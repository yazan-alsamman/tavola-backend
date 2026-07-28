import { RestaurantResult } from '@modules/restaurants/application/dto/restaurant.result';
import { BranchResult } from '@modules/branches/application/dto/branch.result';
import { FloorPlanResult } from '@modules/tables/application/dto/floor-plan.result';
import { TableResult } from '@modules/tables/application/dto/table.result';

export interface DiscoveryListPage<T> {
  items: T[];
  total: number;
}

/**
 * Customer Restaurant Discovery & Public Read Surface. Minimal, read-only,
 * cross-tenant lookup of publicly-discoverable Restaurant/Branch/FloorPlan/
 * Table fields - owned by this bounded context, not a full Restaurants/
 * Branches/Tables repository. Required because discovery is public/
 * unauthenticated (ADR-018 §4 "Search/nearby endpoints are public"): there
 * is no bound `TenantContext.organizationId` to scope by, but `Restaurant`/
 * `Branch`/`FloorPlan`/`Table` are all tenant-owned (directly or
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
  listRestaurants(page: number, limit: number): Promise<DiscoveryListPage<RestaurantResult>>;

  /** Returns `null` for unknown, soft-deleted, or non-`Active` restaurants. */
  getRestaurantById(restaurantId: string): Promise<RestaurantResult | null>;

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
