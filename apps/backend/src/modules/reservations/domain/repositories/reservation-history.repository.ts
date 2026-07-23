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
}

export const RESERVATION_HISTORY_REPOSITORY = Symbol('RESERVATION_HISTORY_REPOSITORY');
