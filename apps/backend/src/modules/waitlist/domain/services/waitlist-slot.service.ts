/**
 * Phase 7.5 final promotion-slot-semantics decision (2026-07-24). Pure
 * domain service, no I/O - mirrors `CancellationWindowService`'s own "pure
 * duration arithmetic" shape (Phase 7.3 precedent). `Branch.timezone` is the
 * authoritative IANA zone (LOCALIZATION.md); the runtime's built-in
 * `Intl.DateTimeFormat` (ICU) resolves any IANA zone's UTC offset for an
 * arbitrary date deterministically, so no third-party timezone dependency is
 * introduced (Phase 7.5 architecture freeze item 3). DST is handled by the
 * zone's own rules, not a hardcoded offset table - `zonedWallTimeToUtc`
 * below performs a two-pass convergence specifically so a date that falls on
 * a DST-transition day still resolves correctly (see this file's own spec
 * for a verified `America/New_York` spring-forward case).
 */
export class WaitlistSlotService {
  /**
   * Combines `preferredDate` (date-only, UTC-midnight as persisted by
   * Prisma's `@db.Date`) with `preferredTimeFrom`'s time-of-day (UTC-epoch
   * time-of-day, as persisted by Prisma's `@db.Time`) interpreted as a wall
   * clock reading in `branchTimezone`, converts to the corresponding UTC
   * instant, then derives the end time via
   * `RestaurantSettings.defaultReservationDurationMinutes` (Phase 7.5 freeze
   * item 1) - `preferredTimeTo` is never read here (non-authoritative).
   */
  static deriveReservationWindow(
    preferredDate: Date,
    preferredTimeFrom: Date,
    branchTimezone: string,
    defaultReservationDurationMinutes: number,
  ): { reservationStartTime: Date; reservationEndTime: Date } {
    const reservationStartTime = WaitlistSlotService.deriveReservationStartTime(
      preferredDate,
      preferredTimeFrom,
      branchTimezone,
    );
    const reservationEndTime = new Date(
      reservationStartTime.getTime() + defaultReservationDurationMinutes * 60_000,
    );
    return { reservationStartTime, reservationEndTime };
  }

  /**
   * The start-time half of `deriveReservationWindow`, exposed separately so
   * Join-time validation (`JoinWaitlistUseCase` - reject a request whose
   * derived start time is already in the past) does not need to resolve
   * `RestaurantSettings.defaultReservationDurationMinutes` merely to compute
   * an end time it doesn't need yet.
   */
  static deriveReservationStartTime(
    preferredDate: Date,
    preferredTimeFrom: Date,
    branchTimezone: string,
  ): Date {
    return zonedWallTimeToUtc(
      preferredDate.getUTCFullYear(),
      preferredDate.getUTCMonth(),
      preferredDate.getUTCDate(),
      preferredTimeFrom.getUTCHours(),
      preferredTimeFrom.getUTCMinutes(),
      preferredTimeFrom.getUTCSeconds(),
      branchTimezone,
    );
  }

  /**
   * End of `preferredDate` (23:59:59.999 local wall clock) in
   * `branchTimezone`, converted to the corresponding UTC instant (Phase 7.5
   * architecture freeze item 1). `preferredTimeFrom`/`preferredTimeTo` never
   * affect this value.
   */
  static computeExpiresAt(preferredDate: Date, branchTimezone: string): Date {
    const endOfDay = zonedWallTimeToUtc(
      preferredDate.getUTCFullYear(),
      preferredDate.getUTCMonth(),
      preferredDate.getUTCDate(),
      23,
      59,
      59,
      branchTimezone,
    );
    return new Date(endOfDay.getTime() + 999);
  }
}

/**
 * Converts a wall-clock reading (year, 0-based month, day, hour, minute,
 * second) in `timeZone` to the UTC instant it represents. Two-pass
 * convergence: the first pass approximates using the target zone's offset at
 * the naive (wall-time-as-UTC) instant, the second pass re-resolves the
 * offset at that improved estimate - correct even when the requested date
 * falls on the zone's own DST-transition day (the offset used differs
 * between the two passes exactly then, and the second pass uses the correct
 * one).
 */
function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const naiveUtcMs = Date.UTC(year, month, day, hour, minute, second);
  const firstPassOffsetMs = resolveOffsetMs(naiveUtcMs, timeZone);
  const secondPassOffsetMs = resolveOffsetMs(naiveUtcMs - firstPassOffsetMs, timeZone);
  return new Date(naiveUtcMs - secondPassOffsetMs);
}

/**
 * The offset (in ms, positive east of UTC) `timeZone` observes at the given
 * UTC instant: `localWallClock - utcInstant`.
 */
function resolveOffsetMs(utcMs: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(new Date(utcMs));
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  const localAsUtcMs = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') === 24 ? 0 : get('hour'),
    get('minute'),
    get('second'),
  );
  return localAsUtcMs - utcMs;
}
