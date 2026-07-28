import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface ListMyReservationsCommand {
  actor: AuthenticatedActor;
  page: number;
  limit: number;
}
