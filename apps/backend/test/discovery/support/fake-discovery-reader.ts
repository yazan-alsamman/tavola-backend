import { RestaurantResult } from '@modules/restaurants/application/dto/restaurant.result';
import { BranchResult } from '@modules/branches/application/dto/branch.result';
import { FloorPlanResult } from '@modules/tables/application/dto/floor-plan.result';
import { TableResult } from '@modules/tables/application/dto/table.result';
import {
  DiscoveryListPage,
  DiscoveryReaderPort,
} from '@modules/discovery/application/ports/discovery-reader.port';

/** In-memory test double for `DiscoveryReaderPort` - unit tests seed it directly. */
export class FakeDiscoveryReader implements DiscoveryReaderPort {
  restaurants: RestaurantResult[] = [];
  branches: BranchResult[] = [];
  floorPlans: FloorPlanResult[] = [];
  tables: TableResult[] = [];

  async listRestaurants(page: number, limit: number): Promise<DiscoveryListPage<RestaurantResult>> {
    const start = (page - 1) * limit;
    return { items: this.restaurants.slice(start, start + limit), total: this.restaurants.length };
  }

  async getRestaurantById(restaurantId: string): Promise<RestaurantResult | null> {
    return this.restaurants.find((r) => r.restaurantId === restaurantId) ?? null;
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
}
