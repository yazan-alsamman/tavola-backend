import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

/** `GET /conversations` - Customer only. */
export interface ListCustomerConversationsCommand {
  actor: AuthenticatedActor;
  includeArchived?: boolean;
  cursor?: string | null;
  limit?: number;
}
