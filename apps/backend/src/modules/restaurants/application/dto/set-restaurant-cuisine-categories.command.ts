import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

/** Full-replace semantics, matching UpdateWorkingHoursCommand's established
 * convention: the given `cuisineCategoryIds` become the restaurant's entire
 * cuisine assignment - an id not present is unassigned. */
export interface SetRestaurantCuisineCategoriesCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
  cuisineCategoryIds: string[];
  correlationId?: string;
}
