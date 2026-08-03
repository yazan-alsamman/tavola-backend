import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface CloseConversationCommand {
  actor: AuthenticatedActor;
  conversationId: string;
  correlationId?: string;
}
