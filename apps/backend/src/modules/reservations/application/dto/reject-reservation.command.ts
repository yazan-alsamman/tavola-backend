import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface RejectReservationCommand {
  actor: AuthenticatedActor;
  reservationId: string;
  correlationId?: string;
}
