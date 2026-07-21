import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface ListRestaurantGalleryCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
}
