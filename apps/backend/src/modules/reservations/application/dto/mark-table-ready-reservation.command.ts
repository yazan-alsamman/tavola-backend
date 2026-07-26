import { AuthenticatedEmployeeActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface MarkTableReadyReservationCommand {
  actor: AuthenticatedEmployeeActor;
  reservationId: string;
  correlationId?: string;
}
