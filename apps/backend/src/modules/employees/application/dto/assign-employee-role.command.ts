import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface AssignEmployeeRoleCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
  employeeId: string;
  roleId: string;
  correlationId?: string;
}
