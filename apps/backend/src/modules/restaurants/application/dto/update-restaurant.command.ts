import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { RestaurantStatus } from '../../domain/enums/restaurant.enums';

/**
 * Full-replace semantics for the profile fields, matching
 * `UpdateUserProfileRequestDto`'s established convention. `status` is
 * included (full CRUD scope, FR-04.3) but handled specially in the use case
 * - a status change publishes `RestaurantActivated`/`RestaurantSuspended`
 * instead of the generic `RestaurantUpdated`, mirroring how
 * `AccountLockedEvent` replaces a generic profile-update event for that one
 * specific transition.
 */
export interface UpdateRestaurantCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
  name: string;
  description: string | null;
  cuisineType: string | null;
  priceLevel: number | null;
  status: RestaurantStatus;
  correlationId?: string;
}
