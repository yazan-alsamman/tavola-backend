import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface MarkNoShowReservationCommand {
  actor: AuthenticatedActor;
  reservationId: string;
  correlationId?: string;
}
