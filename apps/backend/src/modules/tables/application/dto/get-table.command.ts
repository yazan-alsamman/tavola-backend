import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface GetTableCommand {
  actor: AuthenticatedOrganizationMemberActor;
  tableId: string;
}
