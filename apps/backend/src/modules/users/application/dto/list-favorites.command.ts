import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface ListFavoritesCommand {
  actor: AuthenticatedActor;
  page: number;
  limit: number;
}
