import { AuthenticatedEmployeeActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface RejectReservationCommand {
  actor: AuthenticatedEmployeeActor;
  reservationId: string;
  correlationId?: string;
}
