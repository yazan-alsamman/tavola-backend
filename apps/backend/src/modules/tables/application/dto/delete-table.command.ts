import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface DeleteTableCommand {
  actor: AuthenticatedOrganizationMemberActor;
  tableId: string;
  correlationId?: string;
}
