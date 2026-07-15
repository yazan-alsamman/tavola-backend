import { AuthenticatedActor } from './authenticated-actor.dto';

export interface ChangePasswordCommand {
  actor: AuthenticatedActor;
  currentPassword: string;
  newPassword: string;
  correlationId?: string;
}
