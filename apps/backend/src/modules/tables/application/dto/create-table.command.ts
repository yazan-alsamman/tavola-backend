import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { TableShape } from '../../domain/enums/table.enums';

export interface CreateTableCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
  branchId: string;
  floorPlanId: string;
  /**
   * ADR-040 - must name a live Area of `floorPlanId` itself; `null` places the
   * table on the layout with no area.
   */
  floorPlanAreaId: string | null;
  tableNumber: string;
  capacity: number;
  floor: number | null;
  positionX: number | null;
  positionY: number | null;
  width: number | null;
  height: number | null;
  rotation: number | null;
  shape: TableShape;
  /** ADR-040 - `#RRGGBB` override, or `null` to inherit the Area's color. */
  color: string | null;
  layer: number | null;
  indoor: boolean;
  vip: boolean;
  smoking: boolean;
  correlationId?: string;
}
