import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

/**
 * Move Table (Phase 6.2 architecture decision, TASKS.md) - a dedicated
 * Domain Action, not a partial update. Carries only the target placement;
 * no other Table field is settable through this command.
 */
export interface MoveTableCommand {
  actor: AuthenticatedOrganizationMemberActor;
  tableId: string;
  targetFloorPlanId: string;
  /**
   * ADR-040 decision #8 - the Area IN THE TARGET PLAN the table lands in, or
   * `null` to land on the target layout itself. The previous plan's area is
   * never carried over: an Area belongs to exactly one FloorPlan.
   */
  targetFloorPlanAreaId: string | null;
  correlationId?: string;
}
