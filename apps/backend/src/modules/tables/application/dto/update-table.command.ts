import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { TableShape } from '../../domain/enums/table.enums';

/**
 * No `branchId`/`floorPlanId` field - Move Table is explicitly out of Phase
 * 6.1 scope, and the flat `PATCH /tables/:tableId` route (TASKS.md Phase 6.1
 * Routing decision) carries only `tableId`; the table's own current
 * `branchId` is resolved from the existing row, never accepted as input.
 */
export interface UpdateTableCommand {
  actor: AuthenticatedOrganizationMemberActor;
  tableId: string;
  tableNumber: string;
  capacity: number;
  floor: number | null;
  positionX: number | null;
  positionY: number | null;
  width: number | null;
  height: number | null;
  rotation: number | null;
  shape: TableShape;
  layer: number | null;
  indoor: boolean;
  vip: boolean;
  smoking: boolean;
  correlationId?: string;
}
