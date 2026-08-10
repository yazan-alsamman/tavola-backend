export type RevenueReportGroupBy =
  'day' | 'week' | 'month' | 'quarter' | 'year' | 'restaurant' | 'organization' | 'source';

export interface GetRevenueReportCommand {
  from: Date;
  to: Date;
  groupBy: RevenueReportGroupBy;
  restaurantId?: string;
  organizationId?: string;
}

/**
 * `currency` is part of the grouping key, never merged across currencies -
 * ADR-033 §17's "no FX conversion, ever" applies to reporting exactly as
 * much as to pricing resolution: summing raw fee amounts across different
 * currencies into one number would be financially meaningless. A bucket
 * whose acquisitions span two currencies produces two rows (same `key`,
 * different `currency`), never one row with a mixed-currency total.
 */
export interface RevenueReportBucket {
  key: string;
  currency: string;
  recordedCount: number;
  recordedTotal: number;
  reversedCount: number;
  reversedTotal: number;
}

export interface GetRevenueReportResult {
  groupBy: RevenueReportGroupBy;
  buckets: RevenueReportBucket[];
}
