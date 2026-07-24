import { ReservationGuest } from '../entities/reservation-guest.entity';

/**
 * Phase 7.4 - `ReservationGuest` rows are created once, at the same moment
 * as the Phone/WalkIn `Reservation` row that references them, and never
 * mutated by any use case in this phase (no update/anonymize method exists
 * here yet - anonymization is out of scope per Phase 7.4 decision #13).
 * `save` must always be called from inside the same transaction boundary as
 * the `Reservation` insert it belongs to (Phase 7.4 decision #2's atomicity
 * requirement) - never standalone, mirroring `ReservationHistoryRepository`'s
 * own doc comment.
 */
export interface ReservationGuestRepository {
  save(guest: ReservationGuest): Promise<void>;
}

export const RESERVATION_GUEST_REPOSITORY = Symbol('RESERVATION_GUEST_REPOSITORY');
