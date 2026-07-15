import { AuthenticatedActor } from './authenticated-actor.dto';

export interface LogoutCurrentSessionCommand {
  actor: AuthenticatedActor;
  correlationId?: string;
}

export interface LogoutCurrentSessionResult {
  sessionId: string;
}
