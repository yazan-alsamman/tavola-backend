import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface JoinWaitlistReservationGuestInput {
  fullName: string;
  countryCode: string;
  phoneNumber: string;
  email?: string | null;
}

export interface JoinWaitlistCommand {
  actor: AuthenticatedActor;
  branchId: string;
  partySize: number;
  /** ISO date string (`YYYY-MM-DD`), required (Phase 7.5 freeze item 1). */
  preferredDate: string;
  /** `HH:mm` or `HH:mm:ss`, required and authoritative (Phase 7.5 final
   *  promotion-slot-semantics decision, 2026-07-24). */
  preferredTimeFrom: string;
  /** `HH:mm`/`HH:mm:ss`, optional and non-authoritative. */
  preferredTimeTo?: string | null;
  notes?: string | null;
  reservationGuest?: JoinWaitlistReservationGuestInput;
  correlationId?: string;
}
