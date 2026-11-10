import {
  addCalendarDays,
  calendarDateInTimeZone,
  dayOfWeekFromCalendarDate,
  DayScheduleWindow,
  openWindowInstants,
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
