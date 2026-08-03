import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

/** `GET /restaurants/:restaurantId/conversations` - Staff only (Dual Actor, D15). */
export interface ListRestaurantConversationsCommand {
  actor: AuthenticatedActor;
  restaurantId: string;
  cursor?: string | null;
  limit?: number;
}
