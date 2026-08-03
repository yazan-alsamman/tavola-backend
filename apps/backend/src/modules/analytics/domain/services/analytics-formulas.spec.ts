import {
  computeAverage,
  computeRatio,
  zeroFillDayBuckets,
  zeroFillHourBuckets,
} from './analytics-formulas';

describe('analytics-formulas', () => {
  describe('computeRatio', () => {
    it('returns null when denominator is 0 (ADR-028 D42)', () => {
      expect(computeRatio(0, 0)).toBeNull();
      expect(computeRatio(5, 0)).toBeNull();
    });

    it('computes a numeric ratio in 0.0-1.0', () => {
      expect(computeRatio(1, 4)).toBe(0.25);
      expect(computeRatio(4, 4)).toBe(1);
      expect(computeRatio(0, 4)).toBe(0);
    });
  });

  describe('computeAverage', () => {
    it('returns null with zero observations (never 0)', () => {
      expect(computeAverage(0, 0)).toBeNull();
    });

    it('computes the average', () => {
      expect(computeAverage(10, 4)).toBe(2.5);
    });
  });

  describe('zeroFillDayBuckets', () => {
    it('zero-fills every day in a range with no data', () => {
      const buckets = zeroFillDayBuckets('2026-07-01', '2026-07-03', new Map());
      expect(buckets).toEqual([
        { date: '2026-07-01', count: 0 },
        { date: '2026-07-02', count: 0 },
        { date: '2026-07-03', count: 0 },
      ]);
    });

    it('fills known counts and zero-fills the rest', () => {
      const buckets = zeroFillDayBuckets('2026-07-01', '2026-07-03', new Map([['2026-07-02', 5]]));
      expect(buckets).toEqual([
        { date: '2026-07-01', count: 0 },
        { date: '2026-07-02', count: 5 },
        { date: '2026-07-03', count: 0 },
      ]);
    });

    it('handles a single-day range', () => {
      expect(zeroFillDayBuckets('2026-07-01', '2026-07-01', new Map([['2026-07-01', 3]]))).toEqual([
        { date: '2026-07-01', count: 3 },
      ]);
    });

    it('correctly crosses a month boundary', () => {
      const buckets = zeroFillDayBuckets('2026-01-30', '2026-02-02', new Map());
      expect(buckets.map((bucket) => bucket.date)).toEqual([
        '2026-01-30',
        '2026-01-31',
        '2026-02-01',
        '2026-02-02',
      ]);
    });
  });

  describe('zeroFillHourBuckets', () => {
    it('returns exactly 24 zero-filled entries with no data', () => {
      const hours = zeroFillHourBuckets(new Map());
      expect(hours).toHaveLength(24);
      expect(hours.every((count) => count === 0)).toBe(true);
    });

    it('places counts at the correct hour index', () => {
      const hours = zeroFillHourBuckets(
        new Map([
          [0, 2],
          [23, 7],
          [12, 5],
        ]),
      );
      expect(hours).toHaveLength(24);
      expect(hours[0]).toBe(2);
      expect(hours[12]).toBe(5);
      expect(hours[23]).toBe(7);
      expect(hours[1]).toBe(0);
    });
  });
});
