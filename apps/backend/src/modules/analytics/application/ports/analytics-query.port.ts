import { AnalyticsDateRange } from '../dto/analytics-date-range.dto';

/** Restaurant/Organization scope: one or many restaurants, optional branch-id filter, timezone-agnostic (ADR-028 Decision #4). */
export interface AnalyticsRestaurantScope {
  restaurantIds: string[];
  branchIds: string[] | null;
  range: AnalyticsDateRange;
}

/** Branch scope: exactly one branch, its own timezone (ADR-028 Decision #4 requires Branch scope for any bucketed series). */
export interface AnalyticsBranchScope {
  branchId: string;
  timezone: string;
  range: AnalyticsDateRange;
}

export interface ReservationStatusCounts {
  Pending: number;
  Approved: number;
  Rejected: number;
  Cancelled: number;
  Completed: number;
  Expired: number;
  NoShow: number;
}

export interface ReservationSourceCounts {
  Online: number;
  Phone: number;
  WalkIn: number;
  Staff: number;
  WaitlistConversion: number;
}

export interface ReservationSummaryRawData {
  statusCounts: ReservationStatusCounts;
  sourceCounts: ReservationSourceCounts;
  /** ADR-028 Decision #9: Reservation.status = Cancelled AND approvedAt IS NOT NULL. */
  cancelledFromApprovedCount: number;
  partySizeSum: number;
  partySizeCount: number;
}

export interface DayBucketCounts {
  serviceDayCounts: Map<string, number>;
  bookingCreatedCounts: Map<string, number>;
}

export interface CustomerInsightsRawData {
  uniqueRegisteredCustomers: number;
  returningRegisteredCustomers: number;
  guestBackedReservationCount: number;
  partySizeSum: number;
  partySizeCount: number;
}

export interface WaitlistStatusCounts {
  Waiting: number;
  Notified: number;
  Converted: number;
  Cancelled: number;
  Expired: number;
}

export interface ReviewsSummaryRawData {
  activeReviewCount: number;
}

/**
 * Phase 14 (Analytics, ADR-028 Decision #2). Query-only port -
 * `Controller -> Query Use Case -> AnalyticsQueryPort -> Prisma/PostgreSQL`.
 * No mutation methods; no Analytics persistence model backs this port.
 */
export interface AnalyticsQueryPort {
  getReservationSummary(scope: AnalyticsRestaurantScope): Promise<ReservationSummaryRawData>;
  getReservationTrends(scope: AnalyticsBranchScope): Promise<DayBucketCounts>;
  getPeakHours(scope: AnalyticsBranchScope): Promise<Map<number, number>>;
  getCustomerInsights(scope: AnalyticsRestaurantScope): Promise<CustomerInsightsRawData>;
  getWaitlistCounts(scope: AnalyticsRestaurantScope): Promise<WaitlistStatusCounts>;
  getReviewsSummary(restaurantId: string): Promise<ReviewsSummaryRawData>;
}

export const ANALYTICS_QUERY_PORT = Symbol('ANALYTICS_QUERY_PORT');
