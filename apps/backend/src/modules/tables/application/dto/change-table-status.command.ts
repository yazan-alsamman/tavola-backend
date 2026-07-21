import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { TableStatus } from '../../domain/enums/table.enums';

/**
 * Status Management architecture decision (TASKS.md "Phase 6 — Status
 * Management" note) - a dedicated Domain Action. Carries only the target
 * `status`; no other Table field is settable through this command.
 */
export interface ChangeTableStatusCommand {
  actor: AuthenticatedOrganizationMemberActor;
  tableId: string;
  status: TableStatus;
  correlationId?: string;
}
