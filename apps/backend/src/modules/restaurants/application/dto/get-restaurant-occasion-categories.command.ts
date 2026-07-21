import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface GetRestaurantOccasionCategoriesCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
}
