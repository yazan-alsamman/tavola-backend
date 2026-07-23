/**
 * Phase 7.3 (Reservation Lifecycle) - shared by Cancel (flags
 * `ReservationHistory.withinCancellationWindow`, never blocks) and Reschedule
 * (blocks outright, `ReservationRescheduleWindowExpiredException`).
 * `cancellationWindowMinutes` is a pure duration, not a calendar concept -
 * "N minutes before an absolute timestamp" is timezone-invariant arithmetic
 * (the same instant is exactly N minutes before `reservationStartTime`
 * regardless of which timezone a human reads it in), so no Branch-timezone
 * conversion is needed here despite TASKS.md's Phase 7 decision note item 5
 * naming the Branch as the reference timezone for "the cancellation-window
 * clock" - that note governs which entity's timezone concept is
 * authoritative if a timezone-sensitive calendar comparison were ever
 * needed; this duration-based comparison has no such need.
 */
export class CancellationWindowService {
  static isWithinWindow(
    reservationStartTime: Date,
    cancellationWindowMinutes: number,
    now: Date,
  ): boolean {
    const windowStartsAt = reservationStartTime.getTime() - cancellationWindowMinutes * 60_000;
    return now.getTime() >= windowStartsAt;
  }
}
