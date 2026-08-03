/**
 * Phase 14 (Analytics, ADR-028 Decision #2). Pure, stateless formula
 * helpers - the "AnalyticsCalculator" concept referenced in DOMAIN_MODEL.md,
 * now concretely a set of functions rather than a stateful Domain Service.
 * No I/O; every input is already fetched by the calling Query Use Case.
 */

/** ADR-028 D42/D43: zero denominator -> null; otherwise a ratio in 0.0-1.0. */
export function computeRatio(numerator: number, denominator: number): number | null {
  if (denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

/** Zero observations -> null (never 0), matching D42's average semantics. */
export function computeAverage(sum: number, count: number): number | null {
  if (count === 0) {
    return null;
  }
  return sum / count;
}

/**
 * Returns every Branch-local calendar day key (`YYYY-MM-DD`) from `fromKey`
 * to `toKey` inclusive, zero-filled where `counts` has no entry (ADR-028
 * D44). Both keys and `counts`' keys are plain `YYYY-MM-DD` strings compared
 * lexicographically, so no Date parsing/timezone re-interpretation happens
 * here - the caller has already resolved every key in Branch-local terms.
 */
export function zeroFillDayBuckets(
  fromKey: string,
  toKey: string,
  counts: ReadonlyMap<string, number>,
): Array<{ date: string; count: number }> {
  const buckets: Array<{ date: string; count: number }> = [];
  let cursor = fromKey;
  // Bounded by the 366-day maximum range contract (ADR-028 D32) enforced
  // upstream by ResolveAnalyticsDateRangeService, so this loop is bounded.
  while (cursor <= toKey) {
    buckets.push({ date: cursor, count: counts.get(cursor) ?? 0 });
    cursor = nextDayKey(cursor);
  }
  return buckets;
}

/** Zero-fills all 24 Branch-local hour buckets (ADR-028 D11/D44). */
export function zeroFillHourBuckets(counts: ReadonlyMap<number, number>): number[] {
  return Array.from({ length: 24 }, (_, hour) => counts.get(hour) ?? 0);
}

function nextDayKey(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(
    next.getUTCDate(),
  ).padStart(2, '0')}`;
}
