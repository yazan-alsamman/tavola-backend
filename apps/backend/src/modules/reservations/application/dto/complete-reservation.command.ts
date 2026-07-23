import { AuthenticatedEmployeeActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface CompleteReservationCommand {
  actor: AuthenticatedEmployeeActor;
  reservationId: string;
  correlationId?: string;
}
