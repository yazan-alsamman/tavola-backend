import { AuthenticatedEmployeeActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface MarkNoShowReservationCommand {
  actor: AuthenticatedEmployeeActor;
  reservationId: string;
  correlationId?: string;
}
