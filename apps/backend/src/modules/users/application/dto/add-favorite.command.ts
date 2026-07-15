import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface AddFavoriteCommand {
  actor: AuthenticatedActor;
  restaurantId: string;
  ipAddress: string | null;
  correlationId?: string;
}
