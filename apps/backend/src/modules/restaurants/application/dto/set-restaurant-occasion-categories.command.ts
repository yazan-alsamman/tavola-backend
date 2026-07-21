import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

/** Full-replace semantics, matching UpdateWorkingHoursCommand's established
 * convention: the given `occasionCategoryIds` become the restaurant's entire
 * occasion assignment - an id not present is unassigned. */
export interface SetRestaurantOccasionCategoriesCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
  occasionCategoryIds: string[];
  correlationId?: string;
}
