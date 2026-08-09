import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface ExportUserDataCommand {
  actor: AuthenticatedActor;
  correlationId?: string;
}
