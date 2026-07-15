import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface GetCurrentUserProfileCommand {
  actor: AuthenticatedActor;
}
