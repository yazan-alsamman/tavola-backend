import { Injectable } from '@nestjs/common';
import { RestaurantResult } from '@modules/restaurants/application/dto/restaurant.result';
import { BranchResult } from '@modules/branches/application/dto/branch.result';
import { FloorPlanResult } from '@modules/tables/application/dto/floor-plan.result';
import { TableResult } from '@modules/tables/application/dto/table.result';
import { RedisQueryCache } from '@infrastructure/redis/redis-query-cache.service';
import {
  DiscoveryListPage,
  DiscoveryReaderPort,
  ListRestaurantsParams,
  NearbyRestaurantResult,
  NearbySearchParams,
} from '../../application/ports/discovery-reader.port';
import { PrismaDiscoveryReader } from './prisma-discovery-reader';

const TTL_SECONDS = 30;

/**
 * Post-Audit Remediation (2026-08-02, L7). Cache-aside decorator around
 * `PrismaDiscoveryReader` for its two expensive, highest-traffic queries -
 * `listRestaurants` (search/browse) and `searchNearby` (bounding-box
 * prefilter + Haversine refinement) - per the audit's own naming of these
 * as the read-heavy surface. Every other method is a single-row PK lookup
 * (already fast/indexed) and is passed straight through, uncached, to keep
 * this change minimal. Public/unauthenticated by design (ADR-018), so the
 * cache key is safely built from the request params alone - no tenant
 * context to leak across a shared cache entry. 30s TTL, no write-side
 * invalidation - see `RedisQueryCache`'s own doc comment for why.
 */
@Injectable()
export class CachingDiscoveryReader implements DiscoveryReaderPort {
  constructor(
    private readonly inner: PrismaDiscoveryReader,
    private readonly cache: RedisQueryCache,
  ) {}

  listRestaurants(params: ListRestaurantsParams): Promise<DiscoveryListPage<RestaurantResult>> {
    return this.cache.getOrSet(
      `discovery:list-restaurants:${JSON.stringify(params)}`,
      TTL_SECONDS,
      () => this.inner.listRestaurants(params),
    );
  }

  getRestaurantById(restaurantId: string): Promise<RestaurantResult | null> {
    return this.inner.getRestaurantById(restaurantId);
  }

  getRestaurantsByIds(restaurantIds: string[]): Promise<RestaurantResult[]> {
    return this.inner.getRestaurantsByIds(restaurantIds);
  }

  searchNearby(params: NearbySearchParams): Promise<DiscoveryListPage<NearbyRestaurantResult>> {
    return this.cache.getOrSet(
      `discovery:search-nearby:${JSON.stringify(params)}`,
      TTL_SECONDS,
      () => this.inner.searchNearby(params),
    );
  }

  listBranchesByRestaurantId(
    restaurantId: string,
    page: number,
    limit: number,
  ): Promise<DiscoveryListPage<BranchResult>> {
    return this.inner.listBranchesByRestaurantId(restaurantId, page, limit);
  }

  getBranchById(branchId: string, restaurantId: string): Promise<BranchResult | null> {
    return this.inner.getBranchById(branchId, restaurantId);
  }

  getActiveFloorPlanByBranchId(branchId: string): Promise<FloorPlanResult | null> {
    return this.inner.getActiveFloorPlanByBranchId(branchId);
  }

  listTablesByFloorPlanId(floorPlanId: string): Promise<TableResult[]> {
    return this.inner.listTablesByFloorPlanId(floorPlanId);
  }
}
