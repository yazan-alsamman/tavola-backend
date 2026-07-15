import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface GetRestaurantSettingsCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
}
