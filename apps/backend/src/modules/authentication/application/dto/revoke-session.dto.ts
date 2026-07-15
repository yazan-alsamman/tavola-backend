import { AuthenticatedActor } from './authenticated-actor.dto';

export interface RevokeSessionCommand {
  actor: AuthenticatedActor;
  targetSessionId: string;
  correlationId?: string;
}

export interface RevokeSessionResult {
  sessionId: string;
}
