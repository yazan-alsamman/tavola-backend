import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface ListNotificationsCommand {
  actor: AuthenticatedActor;
  page: number;
  limit: number;
  unreadOnly: boolean;
}
