import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface RemoveEmployeeBranchCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
  employeeId: string;
  branchId: string;
  correlationId?: string;
}
