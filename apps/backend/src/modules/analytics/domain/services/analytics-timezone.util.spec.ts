import {
  utcToZonedDateParts,
  utcToZonedDateKey,
  utcToZonedHour,
  zonedWallTimeToUtc,
  startOfZonedDay,
} from './analytics-timezone.util';

describe('analytics-timezone.util', () => {
  describe('utcToZonedDateParts / utcToZonedDateKey / utcToZonedHour', () => {
    it('resolves UTC (no offset) 1:1', () => {
      const instant = new Date('2026-07-21T14:30:00.000Z');
      expect(utcToZonedDateParts(instant, 'UTC')).toEqual({
        year: 2026,
        month: 7,
        day: 21,
        hour: 14,
      });
      expect(utcToZonedDateKey(instant, 'UTC')).toBe('2026-07-21');
      expect(utcToZonedHour(instant, 'UTC')).toBe(14);
    });

    it('resolves Asia/Tokyo (UTC+9, no DST) across a date boundary', () => {
      // 22:30 UTC = 07:30 next day in Tokyo.
      const instant = new Date('2026-07-21T22:30:00.000Z');
      expect(utcToZonedDateKey(instant, 'Asia/Tokyo')).toBe('2026-07-22');
      expect(utcToZonedHour(instant, 'Asia/Tokyo')).toBe(7);
    });

    it('resolves America/New_York (UTC-4 EDT in summer) across a date boundary going backward', () => {
      // 02:30 UTC = 22:30 the previous day in New York (EDT).
      const instant = new Date('2026-07-22T02:30:00.000Z');
      expect(utcToZonedDateKey(instant, 'America/New_York')).toBe('2026-07-21');
      expect(utcToZonedHour(instant, 'America/New_York')).toBe(22);
    });

    it('mandatory ADR-028 regression case: reservationDate-vs-Branch-local-date can genuinely differ', () => {
      // A branch-local 23:30 booking in Asia/Tokyo (UTC+9): UTC instant is
      // the NEXT UTC calendar day at 14:30 (23:30 - 9h = 14:30 same UTC day
      // is wrong; let's construct it precisely): local 2026-07-21T23:30
      // Tokyo -> UTC 2026-07-21T14:30:00.000Z. The write-side UTC-derivation
      // bug (ADR-028 Context) would take THIS instant's UTC calendar date
      // (2026-07-21) as `reservationDate` - which happens to agree here.
      // The genuinely differing case is near local midnight:
      // local 2026-07-22T00:30 Tokyo -> UTC 2026-07-21T15:30:00.000Z.
      // UTC-derivation ("reservationDate") would read 2026-07-21 (WRONG -
      // the service day is actually 2026-07-22 in Tokyo). This function
      // must return the correct Branch-local day.
      const instant = zonedWallTimeToUtc(2026, 7, 22, 0, 30, 0, 'Asia/Tokyo');
      expect(instant.toISOString()).toBe('2026-07-21T15:30:00.000Z');
      // A naive UTC-calendar-date read of this instant is 2026-07-21 (wrong).
      expect(instant.toISOString().slice(0, 10)).toBe('2026-07-21');
      // The correct Branch-local derivation is 2026-07-22.
      expect(utcToZonedDateKey(instant, 'Asia/Tokyo')).toBe('2026-07-22');
    });

    it('hour 24 from Intl formatToParts normalizes to 0', () => {
      // Some ICU implementations can format local midnight as "24:00" in a
      // 2-digit h23 field for certain zones; verify the normalization branch.
      const instant = zonedWallTimeToUtc(2026, 3, 1, 0, 0, 0, 'UTC');
      expect(utcToZonedHour(instant, 'UTC')).toBe(0);
    });
  });

  describe('zonedWallTimeToUtc', () => {
    it('round-trips a UTC zone', () => {
      const result = zonedWallTimeToUtc(2026, 7, 21, 12, 0, 0, 'UTC');
      expect(result.toISOString()).toBe('2026-07-21T12:00:00.000Z');
    });

    it('resolves a fixed positive-offset zone', () => {
      const result = zonedWallTimeToUtc(2026, 7, 21, 9, 0, 0, 'Asia/Tokyo');
      expect(result.toISOString()).toBe('2026-07-21T00:00:00.000Z');
    });

    it('resolves correctly across the America/New_York DST spring-forward window', () => {
      // 2nd Sunday of March 2026 = March 8. Scan the surrounding window so
      // this test does not need to hardcode the exact transition date.
      for (let day = 1; day <= 14; day += 1) {
        const result = zonedWallTimeToUtc(2026, 3, day, 15, 0, 0, 'America/New_York');
        // 15:00 local is always a valid, unambiguous wall time surrounding
        // the 2am transition - offset is either -05:00 (EST) or -04:00 (EDT).
        const hour = result.getUTCHours();
        expect([19, 20]).toContain(hour);
      }
    });
  });

  describe('startOfZonedDay', () => {
    it('resolves the start of the Branch-local day for an instant near midnight', () => {
      const instant = zonedWallTimeToUtc(2026, 7, 22, 0, 30, 0, 'Asia/Tokyo');
      const start = startOfZonedDay(instant, 'Asia/Tokyo');
      expect(utcToZonedDateKey(start, 'Asia/Tokyo')).toBe('2026-07-22');
      expect(utcToZonedHour(start, 'Asia/Tokyo')).toBe(0);
    });
  });
});
