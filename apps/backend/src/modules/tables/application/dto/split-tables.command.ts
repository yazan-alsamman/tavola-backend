import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

/**
 * Phase 6 (Merge/Split Tables, ADR-026 decision #2/#9/#11) - dual-actor
 * command, same actor typing rationale as `MergeTablesCommand`. `tableId`
 * may be any member of the active merge group (ADR-026 decision #9: "Split
 * ... (any member)") - `SplitTablesUseCase` resolves the full group from
 * whichever id is given.
 */
export interface SplitTablesCommand {
  actor: AuthenticatedActor;
  tableId: string;
  correlationId?: string;
}
