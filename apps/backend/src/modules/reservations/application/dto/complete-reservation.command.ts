import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface CompleteReservationCommand {
  actor: AuthenticatedActor;
  reservationId: string;
  correlationId?: string;
}
