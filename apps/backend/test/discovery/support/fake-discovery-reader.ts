import { RestaurantResult } from '@modules/restaurants/application/dto/restaurant.result';
import { BranchResult } from '@modules/branches/application/dto/branch.result';
import { FloorPlanResult } from '@modules/tables/application/dto/floor-plan.result';
import { TableResult } from '@modules/tables/application/dto/table.result';
import { calculateHaversineDistanceKm } from '@modules/discovery/domain/services/nearby-search-geo.util';
import {
  DiscoverableRestaurantFilters,
  DiscoverableRestaurantSort,
  DiscoveryListPage,
  DiscoveryReaderPort,
  ListRestaurantsParams,
  NearbyRestaurantResult,
  NearbySearchParams,
  SortOrder,
} from '@modules/discovery/application/ports/discovery-reader.port';

/**
 * In-memory test double for `DiscoveryReaderPort` - unit tests seed it
 * directly. Phase 15.5 (architecture frozen 2026-07-29) extends this with a
 * faithful (not merely stubbed) reimplementation of filtering/sorting/nearby
 * geo-deduplication, reusing the exact same `calculateHaversineDistanceKm`
 * pure function `PrismaDiscoveryReader` uses - so use-case-level unit tests
 * can exercise real filter/sort/dedup behavior without a database, while
 * `prisma-discovery-reader.integration-spec.ts` proves the same contract
 * against real PostgreSQL.
 */
export class FakeDiscoveryReader implements DiscoveryReaderPort {
  restaurants: RestaurantResult[] = [];
  branches: BranchResult[] = [];
  floorPlans: FloorPlanResult[] = [];
  tables: TableResult[] = [];
  /** Test-only: restaurantId -> assigned CuisineCategory ids. */
  restaurantCuisineCategoryIds = new Map<string, string[]>();
  /** Test-only: restaurantId -> assigned OccasionCategory ids. */
  restaurantOccasionCategoryIds = new Map<string, string[]>();

  async listRestaurants(
    params: ListRestaurantsParams,
  ): Promise<DiscoveryListPage<RestaurantResult>> {
    let items = this.applyFilters(this.restaurants.slice(), params, true);
    items = this.sortRestaurants(items, params.sort, params.order);
    const start = (params.page - 1) * params.limit;
    return { items: items.slice(start, start + params.limit), total: items.length };
  }

  async getRestaurantById(restaurantId: string): Promise<RestaurantResult | null> {
    const found = this.restaurants.find((r) => r.restaurantId === restaurantId);
    return found && found.status === 'Active' ? found : null;
  }

  async getRestaurantsByIds(restaurantIds: string[]): Promise<RestaurantResult[]> {
    const wanted = new Set(restaurantIds);
    return this.restaurants.filter((r) => wanted.has(r.restaurantId) && r.status === 'Active');
  }

  async searchNearby(
    params: NearbySearchParams,
  ): Promise<DiscoveryListPage<NearbyRestaurantResult>> {
    const nearestByRestaurant = new Map<string, { branchId: string; distanceKm: number }>();

    for (const branch of this.branches) {
      if (branch.latitude === null || branch.longitude === null) {
        continue;
      }
      const distanceKm = calculateHaversineDistanceKm(
        params.lat,
        params.lng,
        branch.latitude,
        branch.longitude,
      );
      if (distanceKm > params.radiusKm) {
        continue;
      }
      const existing = nearestByRestaurant.get(branch.restaurantId);
      if (
        !existing ||
        distanceKm < existing.distanceKm ||
        (distanceKm === existing.distanceKm && branch.branchId < existing.branchId)
      ) {
        nearestByRestaurant.set(branch.restaurantId, { branchId: branch.branchId, distanceKm });
      }
    }

    const active = this.restaurants.filter((r) => r.status === 'Active');
    const withDistance: NearbyRestaurantResult[] = [];
    for (const restaurant of active) {
      const nearest = nearestByRestaurant.get(restaurant.restaurantId);
      if (nearest) {
        withDistance.push({
          ...restaurant,
          nearestBranchId: nearest.branchId,
          distanceKm: nearest.distanceKm,
        });
      }
    }

    const filtered = this.applyFilters(withDistance, params, false);
    filtered.sort(
      (a, b) => a.distanceKm - b.distanceKm || a.restaurantId.localeCompare(b.restaurantId),
    );

    const start = (params.page - 1) * params.limit;
    return { items: filtered.slice(start, start + params.limit), total: filtered.length };
  }

  async listBranchesByRestaurantId(
    restaurantId: string,
    page: number,
    limit: number,
  ): Promise<DiscoveryListPage<BranchResult>> {
    const matching = this.branches.filter((b) => b.restaurantId === restaurantId);
    const start = (page - 1) * limit;
    return { items: matching.slice(start, start + limit), total: matching.length };
  }

  async getBranchById(branchId: string, restaurantId: string): Promise<BranchResult | null> {
    return (
      this.branches.find((b) => b.branchId === branchId && b.restaurantId === restaurantId) ?? null
    );
  }

  async getActiveFloorPlanByBranchId(branchId: string): Promise<FloorPlanResult | null> {
    return this.floorPlans.find((f) => f.branchId === branchId && f.isActive) ?? null;
  }

  async listTablesByFloorPlanId(floorPlanId: string): Promise<TableResult[]> {
    return this.tables.filter((t) => t.floorPlanId === floorPlanId);
  }

  private applyFilters<T extends RestaurantResult>(
    items: T[],
    filters: DiscoverableRestaurantFilters,
    includeCity: boolean,
  ): T[] {
    let result = items;
    if (filters.q) {
      const q = filters.q.toLowerCase();
      result = result.filter((r) => r.name.toLowerCase().includes(q));
    }
    if (filters.cuisineId) {
      result = result.filter((r) =>
        (this.restaurantCuisineCategoryIds.get(r.restaurantId) ?? []).includes(filters.cuisineId!),
      );
    }
    if (filters.occasionId) {
      result = result.filter((r) =>
        (this.restaurantOccasionCategoryIds.get(r.restaurantId) ?? []).includes(
          filters.occasionId!,
        ),
      );
    }
    if (filters.priceLevel !== undefined) {
      result = result.filter((r) => r.priceLevel === filters.priceLevel);
    }
    if (filters.minRating !== undefined) {
      result = result.filter(
        (r) => r.averageRating !== null && r.averageRating >= filters.minRating!,
      );
    }
    if (includeCity && filters.city) {
      const city = filters.city.toLowerCase();
      const restaurantIdsInCity = new Set(
        this.branches
          .filter((b) => b.city.toLowerCase() === city && b.restaurantId)
          .map((b) => b.restaurantId),
      );
      result = result.filter((r) => restaurantIdsInCity.has(r.restaurantId));
    }
    return result;
  }

  private sortRestaurants<T extends RestaurantResult>(
    items: T[],
    sort: DiscoverableRestaurantSort | undefined,
    order: SortOrder | undefined,
  ): T[] {
    const sorted = [...items];
    switch (sort) {
      case 'name':
        sorted.sort(
          (a, b) =>
            (order === 'desc' ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)) ||
            a.restaurantId.localeCompare(b.restaurantId),
        );
        break;
      case 'rating':
        sorted.sort((a, b) => {
          if (a.averageRating === null && b.averageRating === null) {
            return a.restaurantId.localeCompare(b.restaurantId);
          }
          if (a.averageRating === null) return 1;
          if (b.averageRating === null) return -1;
          const cmp =
            order === 'asc' ? a.averageRating - b.averageRating : b.averageRating - a.averageRating;
          return cmp || a.restaurantId.localeCompare(b.restaurantId);
        });
        break;
      case 'newest':
        sorted.sort((a, b) => {
          const cmp =
            order === 'asc'
              ? a.createdAt.getTime() - b.createdAt.getTime()
              : b.createdAt.getTime() - a.createdAt.getTime();
          return cmp || a.restaurantId.localeCompare(b.restaurantId);
        });
        break;
      default:
        sorted.sort(
          (a, b) =>
            b.createdAt.getTime() - a.createdAt.getTime() ||
            a.restaurantId.localeCompare(b.restaurantId),
        );
    }
    return sorted;
  }
}
