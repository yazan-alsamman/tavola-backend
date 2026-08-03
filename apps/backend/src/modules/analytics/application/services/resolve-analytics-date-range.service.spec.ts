import { ResolveAnalyticsDateRangeService } from './resolve-analytics-date-range.service';
import { InvalidAnalyticsRangeException } from '../exceptions/invalid-analytics-range.exception';

describe('ResolveAnalyticsDateRangeService', () => {
  const service = new ResolveAnalyticsDateRangeService();
  const now = new Date('2026-07-28T10:00:00.000Z');

  describe('preset resolution (UTC scope)', () => {
    it('resolves "today"', () => {
      const range = service.resolve({ range: 'today' }, null, now);
      expect(range.fromKey).toBe('2026-07-28');
      expect(range.toKey).toBe('2026-07-28');
      expect(range.from.toISOString()).toBe('2026-07-28T00:00:00.000Z');
      expect(range.to.toISOString()).toBe('2026-07-28T23:59:59.999Z');
    });

    it('resolves "last7d" as a 7-day inclusive window ending today', () => {
      const range = service.resolve({ range: 'last7d' }, null, now);
      expect(range.fromKey).toBe('2026-07-22');
      expect(range.toKey).toBe('2026-07-28');
    });

    it('resolves "last30d" as a 30-day inclusive window ending today', () => {
      const range = service.resolve({ range: 'last30d' }, null, now);
      expect(range.fromKey).toBe('2026-06-29');
      expect(range.toKey).toBe('2026-07-28');
    });

    it('resolves "thisMonth" from the 1st through today', () => {
      const range = service.resolve({ range: 'thisMonth' }, null, now);
      expect(range.fromKey).toBe('2026-07-01');
      expect(range.toKey).toBe('2026-07-28');
    });
  });

  describe('preset resolution (Branch-local scope)', () => {
    it('resolves "today" using the Branch timezone, not UTC, near a date boundary', () => {
      // 10:00 UTC = 19:00 in Asia/Tokyo (UTC+9) - same UTC day. Use a UTC
      // instant close to UTC midnight so the Branch-local day differs.
      const lateUtc = new Date('2026-07-28T23:00:00.000Z'); // 08:00 next day in Tokyo
      const range = service.resolve({ range: 'today' }, 'Asia/Tokyo', lateUtc);
      expect(range.fromKey).toBe('2026-07-29');
      expect(range.toKey).toBe('2026-07-29');
    });
  });

  describe('explicit dateFrom/dateTo', () => {
    it('resolves an explicit range', () => {
      const range = service.resolve({ dateFrom: '2026-07-01', dateTo: '2026-07-15' }, null, now);
      expect(range.fromKey).toBe('2026-07-01');
      expect(range.toKey).toBe('2026-07-15');
    });

    it('throws when only one of dateFrom/dateTo is given', () => {
      expect(() => service.resolve({ dateFrom: '2026-07-01' }, null, now)).toThrow(
        InvalidAnalyticsRangeException,
      );
    });

    it('throws when dateFrom is after dateTo (inverted range)', () => {
      expect(() =>
        service.resolve({ dateFrom: '2026-07-15', dateTo: '2026-07-01' }, null, now),
      ).toThrow(InvalidAnalyticsRangeException);
    });

    it('throws on a malformed date', () => {
      expect(() =>
        service.resolve({ dateFrom: '2026/07/01', dateTo: '2026-07-15' }, null, now),
      ).toThrow(InvalidAnalyticsRangeException);
    });
  });

  describe('contradictory combinations', () => {
    it('throws when both a preset and explicit dates are given', () => {
      expect(() => service.resolve({ range: 'today', dateFrom: '2026-07-01' }, null, now)).toThrow(
        InvalidAnalyticsRangeException,
      );
    });
  });

  describe('366-day maximum (ADR-028 D32)', () => {
    it('accepts exactly 366 days', () => {
      const range = service.resolve({ dateFrom: '2026-01-01', dateTo: '2027-01-01' }, null, now);
      expect(range.fromKey).toBe('2026-01-01');
      expect(range.toKey).toBe('2027-01-01');
    });

    it('rejects 367 days', () => {
      expect(() =>
        service.resolve({ dateFrom: '2026-01-01', dateTo: '2027-01-02' }, null, now),
      ).toThrow(InvalidAnalyticsRangeException);
    });

    it('accepts a single day (1-day span)', () => {
      const range = service.resolve({ dateFrom: '2026-07-01', dateTo: '2026-07-01' }, null, now);
      expect(range.fromKey).toBe('2026-07-01');
    });
  });
});
