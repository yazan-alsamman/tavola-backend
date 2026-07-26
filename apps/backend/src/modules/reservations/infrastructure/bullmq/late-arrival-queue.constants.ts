/**
 * Phase 7.6 (Operational Signals, ADR-019). `LateArrivalQueue` - a
 * dedicated queue for the Late-Arrival signal, kept separate from
 * `ReminderQueue` even though both are scheduled together
 * (`ApprovedReservationOperationalSchedulerPort.scheduleForApproved`) so
 * each job type's own delay/backoff/concurrency tuning never interferes
 * with the other, exactly like `ReminderQueue` is kept separate from
 * `ReservationQueue`'s Pending-expiration job.
 */
export const LATE_ARRIVAL_QUEUE_NAME = 'LateArrivalQueue';

export const LATE_ARRIVAL_JOB_NAME = 'reservation-late-arrival';

export interface LateArrivalJobData {
  reservationId: string;
  restaurantId: string;
  branchId: string;
  organizationId: string | null;
  /** ISO-8601 - see `ReservationReminderJobData`'s own doc comment for why
   *  this is carried and re-compared at processing time. */
  reservationStartTime: string;
  correlationId?: string;
}
