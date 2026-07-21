import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface InviteEmployeeCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
  roleId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  correlationId?: string;
}
