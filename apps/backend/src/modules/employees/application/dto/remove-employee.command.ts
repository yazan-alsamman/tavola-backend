import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface RemoveEmployeeCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
  employeeId: string;
  correlationId?: string;
}
