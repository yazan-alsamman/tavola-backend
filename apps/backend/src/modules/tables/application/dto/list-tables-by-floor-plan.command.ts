import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface ListTablesByFloorPlanCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
  branchId: string;
  floorPlanId: string;
  /**
   * ADR-040 - optional filter narrowing the result to one Area (hall) of this
   * FloorPlan. `undefined` returns the whole plan, areas and unassigned tables
   * alike; an id that is not a live Area of this plan is rejected, never
   * silently treated as "no filter".
   */
  floorPlanAreaId?: string;
  page: number;
  limit: number;
}
