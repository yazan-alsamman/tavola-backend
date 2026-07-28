import { Injectable, Inject } from '@nestjs/common';
import { FloorPlanResult } from '@modules/tables/application/dto/floor-plan.result';
import { TableResult } from '@modules/tables/application/dto/table.result';
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

    const tables = await this.discoveryReader.listTablesByFloorPlanId(floorPlan.floorPlanId);
    return { floorPlan, tables };
  }
}
