import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface RemoveRestaurantGalleryImageCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
  galleryItemId: string;
  correlationId?: string;
}
