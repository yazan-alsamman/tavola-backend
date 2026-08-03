import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

/**
 * `POST /conversations` is a Shared endpoint (API_GUIDELINES.md Step 10):
 * a Customer (`User` actor) starts a conversation about themselves -
 * `customerUserId` is ignored for that actor type, the Customer's own
 * `actor.userId` is always used. A Restaurant-side actor (Employee or
 * OrganizationMember, DECISIONS.md D15) starts a conversation on behalf of
 * a specific customer - `customerUserId` is then required.
 */
export interface StartConversationCommand {
  actor: AuthenticatedActor;
  restaurantId: string;
  branchId?: string | null;
  reservationId?: string | null;
  subject?: string | null;
  customerUserId?: string;
  correlationId?: string;
}
