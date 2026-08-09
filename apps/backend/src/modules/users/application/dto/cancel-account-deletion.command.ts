import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface CancelAccountDeletionCommand {
  actor: AuthenticatedActor;
  correlationId?: string;
}
