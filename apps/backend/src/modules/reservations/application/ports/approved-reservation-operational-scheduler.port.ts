/**
 * Phase 7.6 (Operational Signals, ADR-019) - schedules/cancels the two
 * BullMQ delayed jobs (`ReminderQueue`/`LateArrivalQueue`) that exist only
 * while a Reservation is `Approved`: the Reminder job
 * (`reservationReminderMinutesBefore` minutes before `reservationStartTime`)
 * and the Late-Arrival job (`lateArrivalGraceMinutes` minutes after
 * `reservationStartTime`). Mirrors `ReservationExpirationSchedulerPort`'s
 * own shape (a dedicated scheduling port per BullMQ-driven lifecycle
 * concern, not a shared do-everything scheduler). `Reservation` is not
 * directly tenant-owned (no `organizationId` column - see
 * `ReservationRepository`'s own doc comment), so - exactly like
 * `ReservationExpirationSchedulerPort`'s own call sites, which always pass
 * `organizationId: null` literally - the adapter's own job payload carries
 * `organizationId: null` unconditionally (CODING_STANDARDS.md's "every job
 * payload must include organizationId explicitly" is satisfied by the field
 * being present, not by this port's callers ever supplying a real value).
 *
 * Deliberately does NOT publish `WaitlistEntryNotified` or perform any
 * notification delivery - both remain out of scope for this phase (deferred
 * to Phase 9's `NotificationProvider`). This port's only responsibility is
 * scheduling the two BullMQ jobs; what each job's processor does once it
 * fires (publish a domain event) is that processor's own concern.
 */
export interface ApprovedReservationOperationalSchedulerPort {
  /**
   * Schedules both the Reminder and Late-Arrival jobs for a reservation that
   * just became `Approved` (manual Approve, auto-approval on Create, or
   * auto-approval on Waitlist promotion). Removes any pre-existing job for
   * the same reservation first (safe no-op if none exists), exactly like
   * `ReservationExpirationSchedulerPort.scheduleExpiration` - so calling
   * this again always reflects the given `reservationStartTime`, never
   * leaving a stale duplicate.
   */
  scheduleForApproved(
    reservationId: string,
    restaurantId: string,
    branchId: string,
    reservationStartTime: Date,
    reminderMinutesBefore: number,
    lateArrivalGraceMinutes: number,
    correlationId?: string,
  ): Promise<void>;

  /**
   * The Reschedule-of-Approved counterpart of `scheduleForApproved`: removes
   * both existing jobs (which were scheduled against the OLD
   * `reservationStartTime`) and re-adds both against the NEW one. Distinct
   * method name only for call-site clarity (Reschedule vs. first-time
   * Approval) - the underlying remove+re-add mechanism is identical to
   * `scheduleForApproved`, which itself already removes any pre-existing job
   * before adding.
   */
  replaceForApproved(
    reservationId: string,
    restaurantId: string,
    branchId: string,
    reservationStartTime: Date,
    reminderMinutesBefore: number,
    lateArrivalGraceMinutes: number,
    correlationId?: string,
  ): Promise<void>;

  /**
   * Removes both pending delayed jobs for this reservation - called
   * whenever an `Approved` reservation transitions away from `Approved`
   * before either job fires (Cancel/Complete/NoShow), or a Reschedule
   * changes its target status away from `Approved` (a Reschedule landing
   * back on `Approved` uses `replaceForApproved` instead, never this). A
   * safe no-op if no job exists for either queue.
   */
  cancelForReservation(reservationId: string): Promise<void>;
}

export const APPROVED_RESERVATION_OPERATIONAL_SCHEDULER = Symbol(
  'APPROVED_RESERVATION_OPERATIONAL_SCHEDULER',
);
