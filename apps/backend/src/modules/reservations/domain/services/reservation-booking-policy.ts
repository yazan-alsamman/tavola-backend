import {
  addCalendarDays,
  calendarDateInTimeZone,
  dayOfWeekFromCalendarDate,
  DayScheduleWindow,
  openWindowInstants,
  zonedLocalToUtcIso,
} from './reservation-time-slots.service';

/** Shortest and longest reservation a guest or staff member can book. */
export const MIN_RESERVATION_DURATION_MINUTES = 15;
export const MAX_RESERVATION_DURATION_MINUTES = 480;

/** How far ahead a customer can book online. */
export const MAX_ONLINE_BOOKING_ADVANCE_DAYS = 90;

/**
 * Upcoming Pending or Approved reservations one customer may hold at once.
 * Pending reservations already block their table, so without a cap a single
 * account could hold every table of a restaurant.
 */
export const MAX_UPCOMING_ONLINE_RESERVATIONS_PER_CUSTOMER = 5;

export interface WeeklySchedule {
  readonly hasAnyHours: boolean;
  forDay(dayOfWeek: number): DayScheduleWindow | null;
}

export function durationMinutes(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / 60_000;
}

export function isWithinBookingHorizon(start: Date, now: Date): boolean {
  return start.getTime() - now.getTime() <= MAX_ONLINE_BOOKING_ADVANCE_DAYS * 24 * 60 * 60_000;
}

/**
 * True when `[start, end]` lies inside one open range of the branch. The
 * range may belong to the start's own local day or, for an overnight
 * schedule, to the day before it. A restaurant that has configured no
 * working hours at all is treated as always open, matching how it behaved
 * before hours were enforced; once any row exists, a weekday without one is
 * closed.
 */
export function fitsOpeningHours(
  start: Date,
  end: Date,
  timeZone: string,
  schedule: WeeklySchedule,
): boolean {
  if (!schedule.hasAnyHours) {
    return true;
  }
  const localDate = calendarDateInTimeZone(start, timeZone);
  return [localDate, addCalendarDays(localDate, -1)].some((date) =>
    openWindowInstants(date, schedule.forDay(dayOfWeekFromCalendarDate(date)), timeZone).some(
      (window) =>
        window.start.getTime() <= start.getTime() && end.getTime() <= window.end.getTime(),
    ),
  );
}

/**
 * ADR-053: true when an online booking starting at `start` respects the
 * branch's minimum notice.
 */
export function meetsMinLeadTime(start: Date, now: Date, minLeadTimeMinutes: number): boolean {
  return start.getTime() - now.getTime() >= minLeadTimeMinutes * 60_000;
}

/**
 * ADR-053: the last branch-local date a guest may book online, from the
 * branch's own limit or the platform horizon, whichever is shorter.
 */
export function lastBookableDate(today: string, maxDaysAhead: number | null): string {
  const days =
    maxDaysAhead === null
      ? MAX_ONLINE_BOOKING_ADVANCE_DAYS
      : Math.min(maxDaysAhead, MAX_ONLINE_BOOKING_ADVANCE_DAYS);
  return addCalendarDays(today, days);
}

/** ADR-053: the instants a branch-local calendar day starts and ends. */
export function localDayBounds(date: string, timeZone: string): { start: Date; end: Date } {
  return {
    start: new Date(zonedLocalToUtcIso(date, '00:00', timeZone)),
    end: new Date(zonedLocalToUtcIso(addCalendarDays(date, 1), '00:00', timeZone)),
  };
}

/** ADR-053: true when adding `guests` keeps the day within the branch's cap. */
export function fitsDailyGuestCap(
  alreadyBooked: number,
  guests: number,
  dailyGuestCap: number | null,
): boolean {
  return dailyGuestCap === null || alreadyBooked + guests <= dailyGuestCap;
}
