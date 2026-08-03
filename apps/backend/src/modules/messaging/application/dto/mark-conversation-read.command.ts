import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface MarkConversationReadCommand {
  actor: AuthenticatedActor;
  conversationId: string;
  correlationId?: string;
}
