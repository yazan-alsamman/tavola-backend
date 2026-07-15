import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface UpdateUserProfileCommand {
  actor: AuthenticatedActor;
  firstName: string;
  lastName: string;
  phone: string | null;
  language: string;
  preferredCurrency: string | null;
  ipAddress: string | null;
  correlationId?: string;
}
