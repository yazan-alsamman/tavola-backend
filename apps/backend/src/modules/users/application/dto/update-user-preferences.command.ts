import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface UpdateUserPreferencesCommand {
  actor: AuthenticatedActor;
  notificationOptIn: boolean;
  marketingOptIn: boolean;
  ipAddress: string | null;
  correlationId?: string;
}
