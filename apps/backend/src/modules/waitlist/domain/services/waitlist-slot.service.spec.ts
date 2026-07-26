import { WaitlistSlotService } from './waitlist-slot.service';

function timeOfDay(hh: number, mm: number, ss = 0): Date {
  return new Date(Date.UTC(1970, 0, 1, hh, mm, ss));
}

function dateOnly(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

describe('WaitlistSlotService', () => {
  describe('deriveReservationStartTime', () => {
    it('resolves a UTC branch (no offset) 1:1', () => {
      const start = WaitlistSlotService.deriveReservationStartTime(
        dateOnly('2026-08-01'),
        timeOfDay(19, 0),
        'UTC',
      );
      expect(start.toISOString()).toBe('2026-08-01T19:00:00.000Z');
    });

    it('resolves a fixed-offset zone (Asia/Tokyo, UTC+9, no DST)', () => {
      const start = WaitlistSlotService.deriveReservationStartTime(
        dateOnly('2026-08-01'),
        timeOfDay(19, 0),
        'Asia/Tokyo',
      );
      // 19:00 Tokyo = 10:00 UTC (Tokyo is always UTC+9, no DST)
      expect(start.toISOString()).toBe('2026-08-01T10:00:00.000Z');
    });

    it('resolves a negative-offset zone (America/New_York, summer, UTC-4 EDT)', () => {
      const start = WaitlistSlotService.deriveReservationStartTime(
        dateOnly('2026-08-01'),
        timeOfDay(19, 0),
        'America/New_York',
      );
      // 19:00 EDT (UTC-4) = 23:00 UTC
      expect(start.toISOString()).toBe('2026-08-01T23:00:00.000Z');
    });

    it('resolves the same zone correctly in winter (UTC-5 EST, no DST active)', () => {
      const start = WaitlistSlotService.deriveReservationStartTime(
        dateOnly('2026-01-15'),
        timeOfDay(19, 0),
        'America/New_York',
      );
      // 19:00 EST (UTC-5) = 00:00 UTC the next day
      expect(start.toISOString()).toBe('2026-01-16T00:00:00.000Z');
    });

    it('round-trips correctly across the America/New_York DST transition window (no third-party tz dependency, ICU only)', () => {
      // Spring-forward (2nd Sunday of March) and fall-back (1st Sunday of
      // November) always fall within these two-week windows - scanning the
      // whole window guarantees the actual transition day is covered without
      // this test needing to hardcode which exact date it lands on.
      const windows = [
        { start: new Date('2026-03-01T00:00:00.000Z'), days: 14 },
        { start: new Date('2026-11-01T00:00:00.000Z'), days: 14 },
      ];

      for (const window of windows) {
        for (let offset = 0; offset < window.days; offset += 1) {
          const preferredDate = new Date(window.start.getTime() + offset * 86_400_000);
          const requestedTime = timeOfDay(14, 30);

          const utcInstant = WaitlistSlotService.deriveReservationStartTime(
            preferredDate,
            requestedTime,
            'America/New_York',
          );

          // Round-trip: format that UTC instant back into America/New_York
          // wall-clock and confirm it reproduces the original 14:30 request
          // on the original calendar date (verifies the two-pass offset
          // convergence handles the transition day correctly either side).
          const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            hourCycle: 'h23',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          });
          const parts = formatter.formatToParts(utcInstant);
          const get = (type: string) => parts.find((p) => p.type === type)?.value;

          const expectedDateIso = preferredDate.toISOString().slice(0, 10);
          const actualDateIso = `${get('year')}-${get('month')}-${get('day')}`;
          expect(actualDateIso).toBe(expectedDateIso);
          expect(`${get('hour')}:${get('minute')}`).toBe('14:30');
        }
      }
    });
  });

  describe('deriveReservationWindow', () => {
    it('adds defaultReservationDurationMinutes to the derived start time', () => {
      const { reservationStartTime, reservationEndTime } =
        WaitlistSlotService.deriveReservationWindow(
          dateOnly('2026-08-01'),
          timeOfDay(19, 0),
          'UTC',
          90,
        );
      expect(reservationStartTime.toISOString()).toBe('2026-08-01T19:00:00.000Z');
      expect(reservationEndTime.toISOString()).toBe('2026-08-01T20:30:00.000Z');
    });
  });

  describe('computeExpiresAt', () => {
    it('resolves end-of-day (23:59:59.999) in the branch timezone, converted to UTC', () => {
      const expiresAt = WaitlistSlotService.computeExpiresAt(
        dateOnly('2026-08-01'),
        'America/New_York',
      );
      // 23:59:59.999 EDT (UTC-4) = 03:59:59.999 UTC the next day
      expect(expiresAt.toISOString()).toBe('2026-08-02T03:59:59.999Z');
    });

    it('is unaffected by preferredTimeFrom (not a parameter at all)', () => {
      const expiresAt = WaitlistSlotService.computeExpiresAt(dateOnly('2026-08-01'), 'UTC');
      expect(expiresAt.toISOString()).toBe('2026-08-01T23:59:59.999Z');
    });
  });
});
