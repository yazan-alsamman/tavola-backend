import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface RescheduleReservationCommand {
  actor: AuthenticatedActor;
  reservationId: string;
  tableId?: string;
  reservationStartTime?: string;
  reservationEndTime?: string;
  guests?: number;
  correlationId?: string;
}
