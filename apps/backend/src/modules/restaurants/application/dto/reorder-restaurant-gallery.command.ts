import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface ReorderRestaurantGalleryCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
  /** Every gallery image of the restaurant, once, in the new order. */
  galleryItemIds: string[];
  correlationId?: string;
}
