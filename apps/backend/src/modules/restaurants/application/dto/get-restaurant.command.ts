import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface GetRestaurantCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
}
