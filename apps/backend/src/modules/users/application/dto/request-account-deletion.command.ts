import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface RequestAccountDeletionCommand {
  actor: AuthenticatedActor;
  password: string;
  correlationId?: string;
}
