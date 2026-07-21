import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

/**
 * Move Table (Phase 6.2 architecture decision, TASKS.md) - a dedicated
 * Domain Action, not a partial update. Carries only `targetFloorPlanId`;
 * no other Table field is settable through this command.
 */
export interface MoveTableCommand {
  actor: AuthenticatedOrganizationMemberActor;
  tableId: string;
  targetFloorPlanId: string;
  correlationId?: string;
}
