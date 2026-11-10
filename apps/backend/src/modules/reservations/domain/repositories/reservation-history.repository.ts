import { ReservationHistory } from '../entities/reservation-history.entity';

/**
 * Phase 7.3 - `ReservationHistory` rows are append-only audit-trail records;
 * `save` is always an insert, never an update (the entity has no domain
 * methods that mutate an existing row). Must always be called from inside
 * the same `UnitOfWorkPort` transaction as the lifecycle mutation it
 * records (Cancel/Reschedule/Complete/NoShow/Expire) - never standalone.
 */
export interface ReservationHistoryRepository {
  save(history: ReservationHistory): Promise<void>;
  /**
   * True when the reservation was completed by the auto-close sweep (an
   * `Approved -> Completed` row with no operator) rather than by staff,
   * so nobody confirmed the guest actually came.
   */
  wasCompletedBySystem(reservationId: string): Promise<boolean>;
}

export const RESERVATION_HISTORY_REPOSITORY = Symbol('RESERVATION_HISTORY_REPOSITORY');
