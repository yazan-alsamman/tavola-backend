import { AuthenticatedEmployeeActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface ApproveReservationCommand {
  actor: AuthenticatedEmployeeActor;
  reservationId: string;
  correlationId?: string;
}
