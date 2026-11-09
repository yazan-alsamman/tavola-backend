import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface UpdateReservationInternalNoteCommand {
  actor: AuthenticatedActor;
  reservationId: string;
  internalNote: string | null;
}

export interface ReservationInternalNoteResult {
  reservationId: string;
  internalNote: string | null;
}
