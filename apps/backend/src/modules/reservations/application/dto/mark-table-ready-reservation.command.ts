import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface MarkTableReadyReservationCommand {
  actor: AuthenticatedActor;
  reservationId: string;
  correlationId?: string;
}
