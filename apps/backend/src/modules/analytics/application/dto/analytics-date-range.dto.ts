export type AnalyticsRangePreset = 'today' | 'last7d' | 'last30d' | 'thisMonth';

/** Raw, unvalidated range input as received from the query DTO. */
export interface AnalyticsDateRangeQuery {
  range?: AnalyticsRangePreset;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Resolved, validated range. `from`/`to` are UTC instants (inclusive) for
 * querying. `fromKey`/`toKey` are the original `YYYY-MM-DD` calendar-day
 * keys the range was resolved in (Branch-local when a timezone was given,
 * UTC otherwise) - callers needing to zero-fill day buckets MUST use these
 * keys, not re-derive them from `from`/`to`: converting a Branch-local
 * midnight UTC instant back via `toISOString()` can land on the wrong UTC
 * calendar date for any non-zero offset.
 */
export interface AnalyticsDateRange {
  from: Date;
  to: Date;
  fromKey: string;
  toKey: string;
}
