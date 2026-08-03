import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface ListRestaurantOffersCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
  page: number;
  limit: number;
}
