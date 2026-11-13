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
  /** Legacy single name (app 1.0.2 era); used only when neither nameAr nor nameEn is sent. */
  name?: string | null;
  /** ADR-052. Undefined = not sent by this client. */
  nameAr?: string | null;
  nameEn?: string | null;
  description: string | null;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
  cuisineType: string | null;
  status: RestaurantStatus;
  correlationId?: string;
}
