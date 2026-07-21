import { ReservationAvailabilityService } from './reservation-availability.service';

describe('ReservationAvailabilityService', () => {
  describe('deriveTimeSlotBucket', () => {
    it('buckets a time to its 30-minute interval', () => {
      expect(
        ReservationAvailabilityService.deriveTimeSlotBucket(
          new Date('2026-08-01T18:00:00.000Z'),
          30,
        ),
      ).toBe(36);
      expect(
        ReservationAvailabilityService.deriveTimeSlotBucket(
          new Date('2026-08-01T18:29:00.000Z'),
          30,
        ),
      ).toBe(36);
      expect(
        ReservationAvailabilityService.deriveTimeSlotBucket(
          new Date('2026-08-01T18:30:00.000Z'),
          30,
        ),
      ).toBe(37);
    });
  });

  describe('deriveLockKey', () => {
    it('produces a stable, distinct composite key per (branch, table, date, bucket)', () => {
      const date = new Date('2026-08-01T00:00:00.000Z');
      const keyA = ReservationAvailabilityService.deriveLockKey('branch-1', 'table-1', date, 36);
      const keyB = ReservationAvailabilityService.deriveLockKey('branch-1', 'table-1', date, 36);
      const keyC = ReservationAvailabilityService.deriveLockKey('branch-1', 'table-2', date, 36);

      expect(keyA).toBe(keyB);
      expect(keyA).not.toBe(keyC);
    });
  });
});
