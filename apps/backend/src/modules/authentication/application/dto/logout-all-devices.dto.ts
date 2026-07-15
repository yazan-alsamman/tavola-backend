import { AuthenticatedActor } from './authenticated-actor.dto';

export interface LogoutAllDevicesCommand {
  actor: AuthenticatedActor;
  correlationId?: string;
}

export interface LogoutAllDevicesResult {
  sessionVersion: number;
}
