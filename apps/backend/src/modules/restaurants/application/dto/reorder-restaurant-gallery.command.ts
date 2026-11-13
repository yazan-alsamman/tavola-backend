import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface ReorderRestaurantGalleryCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
  /** ADR-051: the branch whose photos these are; omitted, the restaurant's oldest branch. */
  branchId?: string;
  /** Every gallery image of the restaurant, once, in the new order. */
  galleryItemIds: string[];
  correlationId?: string;
}
