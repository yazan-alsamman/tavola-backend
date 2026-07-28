import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface GetMyReservationCommand {
  actor: AuthenticatedActor;
  reservationId: string;
}
