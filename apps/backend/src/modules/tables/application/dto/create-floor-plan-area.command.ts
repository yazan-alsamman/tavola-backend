import { FloorPlanAreaFeature } from '../../domain/enums/table.enums';
import { FloorPlanAreaLayout } from '../../domain/entities/floor-plan-area.entity';
import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface CreateFloorPlanAreaCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
  branchId: string;
  floorPlanId: string;
  name: string;
  color: string;
  sortOrder: number;
  features?: FloorPlanAreaFeature[];
  layout?: FloorPlanAreaLayout;
  correlationId?: string;
}
