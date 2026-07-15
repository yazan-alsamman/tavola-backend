import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface ListRestaurantsCommand {
  actor: AuthenticatedOrganizationMemberActor;
  page: number;
  limit: number;
}
