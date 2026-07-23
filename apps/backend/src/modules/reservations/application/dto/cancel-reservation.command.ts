import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface CancelReservationCommand {
  actor: AuthenticatedActor;
  reservationId: string;
  reason: string | null;
  correlationId?: string;
}
