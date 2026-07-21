import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface GetRestaurantCuisineCategoriesCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
}
