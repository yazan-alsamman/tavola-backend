/**
 * ADR-047 (CR WJ-R-2026-002 round 2): when an offer applies to a booking.
 * Pure, so the Offer aggregate and the Reservations attribution adapter
 * share one definition. Counted conditions (once per customer, booking
 * cap) need the database and are checked by that adapter.
 */
export interface OfferConditions {
  startsAt: Date;
  endsAt: Date;
  /** 0 = Sunday ... 6 = Saturday. Empty = every day. */
  daysOfWeek: number[];
  /** "HH:mm", both null = all day. The window is [startTime, endTime). */
  startTime: string | null;
  endTime: string | null;
  minPartySize: number | null;
  /** Empty = every branch. */
  branchIds: string[];
}

export interface OfferBooking {
  branchId: string;
  partySize: number;
  /** The visit's start, as a UTC instant. */
  startTime: Date;
  /** The branch's IANA zone; days and hours are the branch's local ones. */
  timeZone: string;
}

export const OFFER_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function offerAcceptsBooking(conditions: OfferConditions, booking: OfferBooking): boolean {
  const at = booking.startTime.getTime();
  if (at < conditions.startsAt.getTime() || at >= conditions.endsAt.getTime()) {
    return false;
  }
  if (conditions.branchIds.length > 0 && !conditions.branchIds.includes(booking.branchId)) {
    return false;
  }
  if (conditions.minPartySize !== null && booking.partySize < conditions.minPartySize) {
    return false;
  }
  const local = localDayAndMinutes(booking.startTime, booking.timeZone);
  if (conditions.daysOfWeek.length > 0 && !conditions.daysOfWeek.includes(local.dayOfWeek)) {
    return false;
  }
  if (conditions.startTime !== null && conditions.endTime !== null) {
    const from = minutesOf(conditions.startTime);
    const to = minutesOf(conditions.endTime);
    if (local.minutes < from || local.minutes >= to) {
      return false;
    }
  }
  return true;
}

export function minutesOf(time: string): number {
  const match = OFFER_TIME_PATTERN.exec(time);
  if (!match) {
    throw new Error(`"${time}" is not an HH:mm time.`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** The local weekday (0 = Sunday) and minute of the day of `instant` in `timeZone`. */
export function localDayAndMinutes(
  instant: Date,
  timeZone: string,
): { dayOfWeek: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  const hour = Number(get('hour')) % 24;
  return { dayOfWeek: WEEKDAYS[get('weekday')] ?? 0, minutes: hour * 60 + Number(get('minute')) };
}
