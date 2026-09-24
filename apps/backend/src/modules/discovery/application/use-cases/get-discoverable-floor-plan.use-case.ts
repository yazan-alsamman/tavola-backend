import { Injectable, Inject } from '@nestjs/common';
import { FloorPlanResult } from '@modules/tables/application/dto/floor-plan.result';
import { TableResult } from '@modules/tables/application/dto/table.result';
import { FloorPlanAreaResult } from '@modules/tables/application/dto/floor-plan-area.result';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import { FloorPlanNotFoundException } from '@modules/tables/domain/exceptions/floor-plan-not-found.exception';
import { DiscoveryReaderPort, DISCOVERY_READER } from '../ports/discovery-reader.port';

export interface GetDiscoverableFloorPlanCommand {
  restaurantId: string;
  branchId: string;
}

export interface DiscoverableFloorPlanResult {
  floorPlan: FloorPlanResult;
  areas: FloorPlanAreaResult[];
  tables: TableResult[];
}

/**
 * Customer Restaurant Discovery & Public Read Surface. Public/unauthenticated.
 * Returns the branch's single active FloorPlan together with its table
 * topology (position/dimensions/shape/capacity/status/merge fields) in one
 * bounded call - the seating-chart rendering a Customer reservation UX needs
 * (CUSTOMER RESTAURANT DISCOVERY task §8). A branch with no active FloorPlan
 * yet (never configured) 404s exactly like an unknown branch - there is
 * nothing to render. Does not duplicate SearchAvailability - table-level
 * time/party-size availability remains GET /reservations/availability's own
 * sole authority (ADR-013); this endpoint returns static topology only.
 *
 * ADR-040 - the response also carries the layout's concurrent dining areas
 * (halls) and each table's `floorPlanAreaId`/`color`, so a customer-facing
 * seating chart renders the same grouping the staff editor shows instead of one
 * undifferentiated room. Areas and tables are fetched as two independent
 * queries rather than one nested include: both are already bounded by a single
 * FloorPlan, and keeping them flat means the areas list stays complete even
 * when a hall currently holds no tables - an empty hall is still a tab the
 * chart must draw.
 */
@Injectable()
export class GetDiscoverableFloorPlanUseCase {
  constructor(@Inject(DISCOVERY_READER) private readonly discoveryReader: DiscoveryReaderPort) {}

  async execute(command: GetDiscoverableFloorPlanCommand): Promise<DiscoverableFloorPlanResult> {
    const restaurant = await this.discoveryReader.getRestaurantById(command.restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const branch = await this.discoveryReader.getBranchById(command.branchId, command.restaurantId);
    if (branch === null) {
      throw new BranchNotFoundException();
    }

    const floorPlan = await this.discoveryReader.getActiveFloorPlanByBranchId(command.branchId);
    if (floorPlan === null) {
      throw new FloorPlanNotFoundException();
    }

    const [areas, tables] = await Promise.all([
      this.discoveryReader.listFloorPlanAreasByFloorPlanId(floorPlan.floorPlanId),
      this.discoveryReader.listTablesByFloorPlanId(floorPlan.floorPlanId),
    ]);
    return { floorPlan, areas, tables };
  }
}
