/**
 * Candidate reservation starts for one weekday.
 *
 * Working hours are the open window, not the slot list. Starts step forward
 * from opening by `intervalMinutes`. A start is kept only when
 * `[start, start + durationMinutes)` fits entirely inside that window and
 * does not overlap the break. Overnight closing (closing earlier than
 * opening) is one continuous range, so a duration may cross midnight.
 */
export interface DayScheduleWindow {
  openingTime: string;
  closingTime: string;
  breakStartTime: string | null;
  breakEndTime: string | null;
}

export interface LocalReservationTimeSlot {
  /** HH:mm in the branch timezone. */
  startTime: string;
  /** Calendar date of this start. Next day when the window crosses midnight. */
  date: string;
  /** HH:mm in the branch timezone. */
  endTime: string;
  /** Calendar date of this end. Next day when the window crosses midnight. */
  endDate: string;
}

interface MinuteWindow {
  start: number;
  end: number;
}

const MINUTES_PER_DAY = 24 * 60;

export function buildReservationTimeSlots(
  date: string,
  schedule: DayScheduleWindow | null,
  intervalMinutes: number,
  durationMinutes: number,
): LocalReservationTimeSlot[] {
  if (schedule === null || intervalMinutes < 1 || durationMinutes < 1) {
    return [];
  }

  const slots: LocalReservationTimeSlot[] = [];
  for (const window of openWindows(schedule)) {
    for (
      let minute = window.start;
      minute + durationMinutes <= window.end;
      minute += intervalMinutes
    ) {
      const end = minute + durationMinutes;
      slots.push({
        startTime: formatMinutes(minute % MINUTES_PER_DAY),
        date: addCalendarDays(date, Math.floor(minute / MINUTES_PER_DAY)),
        endTime: formatMinutes(end % MINUTES_PER_DAY),
        endDate: addCalendarDays(date, Math.floor(end / MINUTES_PER_DAY)),
      });
    }
  }
  return slots;
}

export function dayOfWeekFromCalendarDate(date: string): number {
  const parts = parseCalendarDate(date);
  if (parts === null) {
    throw new Error(`"${date}" is not a calendar date.`);
  }
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

export function parseCalendarDate(
  value: string,
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function addCalendarDays(date: string, days: number): string {
  const parts = parseCalendarDate(date);
  if (parts === null) {
    throw new Error(`"${date}" is not a calendar date.`);
  }
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  const month = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const day = String(utc.getUTCDate()).padStart(2, '0');
  return `${utc.getUTCFullYear()}-${month}-${day}`;
}

/** Converts a branch-local wall time to a UTC ISO instant. */
export function zonedLocalToUtcIso(date: string, time: string, timeZone: string): string {
  const parts = parseCalendarDate(date);
  if (parts === null) {
    throw new Error(`"${date}" is not a calendar date.`);
  }
  const [hour, minute] = time.split(':').map(Number);
  const desiredUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute, 0);
  let utc = desiredUtc - timeZoneOffsetMs(new Date(desiredUtc), timeZone);
  utc = desiredUtc - timeZoneOffsetMs(new Date(utc), timeZone);
  return new Date(utc).toISOString();
}

/** YYYY-MM-DD of an instant in an IANA timezone. */
export function calendarDateInTimeZone(instant: Date, timeZone: string): string {
  const parts = zonedParts(instant, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function openWindows(schedule: DayScheduleWindow): MinuteWindow[] {
  const open = toMinutes(schedule.openingTime);
  const close = toMinutes(schedule.closingTime);
  if (close === open) {
    return [];
  }

  const end = close > open ? close : close + MINUTES_PER_DAY;
  let segments: MinuteWindow[] = [{ start: open, end }];

  if (schedule.breakStartTime !== null && schedule.breakEndTime !== null) {
    let breakStart = toMinutes(schedule.breakStartTime);
    let breakEnd = toMinutes(schedule.breakEndTime);
    if (close < open && breakEnd <= open) {
      breakStart += MINUTES_PER_DAY;
      breakEnd += MINUTES_PER_DAY;
    }
    segments = segments.flatMap((segment) => subtractBreak(segment, breakStart, breakEnd));
  }
  return segments;
}

function subtractBreak(
  segment: MinuteWindow,
  breakStart: number,
  breakEnd: number,
): MinuteWindow[] {
  if (breakEnd <= segment.start || breakStart >= segment.end) {
    return [segment];
  }
  const pieces: MinuteWindow[] = [];
  if (breakStart > segment.start) {
    pieces.push({ start: segment.start, end: Math.min(breakStart, segment.end) });
  }
  if (breakEnd < segment.end) {
    pieces.push({ start: Math.max(breakEnd, segment.start), end: segment.end });
  }
  return pieces;
}

function toMinutes(hhmm: string): number {
  const [hour, minute] = hhmm.split(':').map(Number);
  return hour * 60 + minute;
}

function formatMinutes(total: number): string {
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - instant.getTime();
}

function zonedParts(
  instant: Date,
  timeZone: string,
): { year: string; month: string; day: string; hour: string; minute: string; second: string } {
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
  const parts = Object.fromEntries(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}
