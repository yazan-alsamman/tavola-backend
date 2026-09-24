import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

/**
 * Full-replace semantics, matching `UpdateTableCommand`'s own convention -
 * never `floorPlanId` (an Area cannot migrate between layouts; see
 * `FloorPlanArea.updateProfile`).
 */
export interface UpdateFloorPlanAreaCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
  branchId: string;
  floorPlanId: string;
  floorPlanAreaId: string;
  name: string;
  color: string;
  sortOrder: number;
  correlationId?: string;
}
