/**
 * Phase 7.6 (Operational Signals, ADR-019). `ReminderQueue` is one of the
 * platform queues already named in EVENTS.md's "BullMQ Queue Events"
 * section - this is its first real producer/consumer pair. Dedicated to the
 * Reminder signal only (not shared with `ReservationQueue`'s Pending-
 * expiration job) so its own delay/backoff/concurrency tuning never
 * interferes with expiration.
 */
export const REMINDER_QUEUE_NAME = 'ReminderQueue';

export const RESERVATION_REMINDER_JOB_NAME = 'reservation-reminder-due';

/**
 * CODING_STANDARDS.md: every BullMQ job payload carries `organizationId`
 * explicitly - omitted here deliberately, mirroring
 * `ExpireReservationJobData`'s own `organizationId: string | null` field,
 * except this job additionally carries `restaurantId`/`branchId` (already
 * resolved at schedule time) so the processor never needs a second lookup
 * just to attach tenant/branch context to the published event.
 */
export interface ReservationReminderJobData {
  reservationId: string;
  restaurantId: string;
  branchId: string;
  organizationId: string | null;
  /** ISO-8601 - the reservationStartTime the job was scheduled against.
   *  The processor re-loads the reservation and compares this against its
   *  current reservationStartTime - a mismatch means a reschedule moved the
   *  window after this job was queued but before a `replaceForApproved`
   *  cancel/re-add caught up, so the stale firing is a safe no-op. */
  reservationStartTime: string;
  correlationId?: string;
}
