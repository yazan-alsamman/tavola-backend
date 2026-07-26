import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

/**
 * No `reason` field - unlike `Reservation.cancel`, `ReservationWaitlistEntry`
 * has neither a dedicated cancellation-reason column nor a
 * `ReservationHistory`-equivalent table to record one in (Phase 7.5's
 * frozen schema, DATABASE_SCHEMA.md "Reservation Waitlist Entries" -
 * inventing a new column/table for this was never authorized).
 */
export interface CancelWaitlistEntryCommand {
  actor: AuthenticatedActor;
  entryId: string;
  correlationId?: string;
}
