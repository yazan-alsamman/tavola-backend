import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

/**
 * Phase 6 (Merge/Split Tables, ADR-026 decision #1/#9/#11) - dual-actor
 * command (`AuthenticatedActor`, not `AuthenticatedOrganizationMemberActor`)
 * since `MergeTablesUseCase` is reachable by both an OrganizationMember
 * Owner/Admin and a branch-scoped Employee holding `tables:manage`; see
 * `assertActorCanManageTables`. `primaryTableId` is optional - when absent,
 * `TableMergeService.selectPrimary` derives it (lowest `tableNumber`, then
 * `Table.id` ascending).
 */
export interface MergeTablesCommand {
  actor: AuthenticatedActor;
  tableIds: string[];
  primaryTableId?: string;
  correlationId?: string;
}
