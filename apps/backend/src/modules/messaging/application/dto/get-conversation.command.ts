import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface GetConversationCommand {
  actor: AuthenticatedActor;
  conversationId: string;
}
