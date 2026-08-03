/**
 * Phase 14 (Analytics, ADR-028). `Branch.timezone` is the authoritative IANA
 * zone for every Branch-local bucketing decision (ADR-028 Decision #4). This
 * file mirrors `WaitlistSlotService`'s own `Intl.DateTimeFormat`-based offset
 * resolution (Phase 7.5 precedent - no third-party timezone dependency) but
 * in both directions: `zonedWallTimeToUtc` (wall-clock -> UTC instant, used
 * to resolve a requested date range's Branch-local day boundaries) and
 * `utcToZonedDateParts` (UTC instant -> Branch-local wall-clock parts, used
 * to bucket a persisted `reservationStartTime`/`createdAt` timestamp into its
 * correct Branch-local calendar day/hour). ADR-028's core finding is that
 * `Reservation.reservationDate` is NOT reliably Branch-local (UTC-derived on
 * most write paths) - these functions are the read-side mitigation: every
 * Branch-local bucket Analytics computes is derived here, at query time,
 * never from the stored `reservationDate` column.
 */

export interface ZonedDateParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
}

/** Converts a wall-clock reading in `timeZone` to the UTC instant it represents. */
export function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstPassOffsetMs = resolveOffsetMs(naiveUtcMs, timeZone);
  const secondPassOffsetMs = resolveOffsetMs(naiveUtcMs - firstPassOffsetMs, timeZone);
  return new Date(naiveUtcMs - secondPassOffsetMs);
}

/** Resolves the Branch-local wall-clock year/month/day/hour for a UTC instant. */
export function utcToZonedDateParts(instant: Date, timeZone: string): ZonedDateParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
  });
  const parts = formatter.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const hour = get('hour');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: hour === 24 ? 0 : hour,
  };
}

/** `YYYY-MM-DD` Branch-local calendar date key for a UTC instant. */
export function utcToZonedDateKey(instant: Date, timeZone: string): string {
  const { year, month, day } = utcToZonedDateParts(instant, timeZone);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Branch-local wall-clock hour (0-23) for a UTC instant. */
export function utcToZonedHour(instant: Date, timeZone: string): number {
  return utcToZonedDateParts(instant, timeZone).hour;
}

/** Start of the Branch-local calendar day containing `instant`, as a UTC instant. */
export function startOfZonedDay(instant: Date, timeZone: string): Date {
  const { year, month, day } = utcToZonedDateParts(instant, timeZone);
  return zonedWallTimeToUtc(year, month, day, 0, 0, 0, timeZone);
}

/** The offset (ms, positive east of UTC) `timeZone` observes at `utcMs`. */
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
