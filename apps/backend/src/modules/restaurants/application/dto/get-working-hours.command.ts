import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface GetWorkingHoursCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
}
