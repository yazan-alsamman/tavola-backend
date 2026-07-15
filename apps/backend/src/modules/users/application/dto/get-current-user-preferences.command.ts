import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface GetCurrentUserPreferencesCommand {
  actor: AuthenticatedActor;
}
