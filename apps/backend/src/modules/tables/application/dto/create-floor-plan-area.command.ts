import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface CreateFloorPlanAreaCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
  branchId: string;
  floorPlanId: string;
  name: string;
  color: string;
  sortOrder: number;
  correlationId?: string;
}
