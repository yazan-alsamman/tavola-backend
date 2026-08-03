import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface ListMessagesCommand {
  actor: AuthenticatedActor;
  conversationId: string;
  cursor?: string | null;
  limit?: number;
}
