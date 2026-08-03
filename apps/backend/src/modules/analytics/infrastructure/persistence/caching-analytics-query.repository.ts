import { Injectable } from '@nestjs/common';
import {
  RedisQueryCache,
  RedisQueryCacheCodec,
} from '@infrastructure/redis/redis-query-cache.service';
import {
  AnalyticsBranchScope,
  AnalyticsQueryPort,
  AnalyticsRestaurantScope,
  CustomerInsightsRawData,
  DayBucketCounts,
  ReservationSummaryRawData,
  ReviewsSummaryRawData,
  WaitlistStatusCounts,
} from '../../application/ports/analytics-query.port';
import { PrismaAnalyticsQueryRepository } from './prisma-analytics-query.repository';

const TTL_SECONDS = 60;

/** `Map` is not round-trippable through `JSON.stringify`/`JSON.parse` directly - encode as entry arrays. */
const dayBucketCountsCodec: RedisQueryCacheCodec<DayBucketCounts> = {
  serialize: (value) =>
    JSON.stringify({
      serviceDayCounts: [...value.serviceDayCounts.entries()],
      bookingCreatedCounts: [...value.bookingCreatedCounts.entries()],
    }),
  deserialize: (raw) => {
    const parsed = JSON.parse(raw) as {
      serviceDayCounts: [string, number][];
      bookingCreatedCounts: [string, number][];
    };
    return {
      serviceDayCounts: new Map(parsed.serviceDayCounts),
      bookingCreatedCounts: new Map(parsed.bookingCreatedCounts),
    };
  },
};

const peakHoursCodec: RedisQueryCacheCodec<Map<number, number>> = {
  serialize: (value) => JSON.stringify([...value.entries()]),
  deserialize: (raw) => new Map(JSON.parse(raw) as [number, number][]),
};

/**
 * Post-Audit Remediation (2026-08-02, L7). Cache-aside decorator around
 * `PrismaAnalyticsQueryRepository` for all six aggregate queries - these are
 * exactly the "read-heavy, expensive to compute" surface the audit named,
 * and every method here is scope-in/aggregate-out (no per-row cursor state
 * to worry about). 60s TTL, no write-side invalidation - see
 * `RedisQueryCache`'s own doc comment for why; a dashboard aggregate being
 * up to a minute stale is an accepted tradeoff, not a correctness issue.
 * `Map`-returning methods use an explicit codec since `Map` does not
 * survive `JSON.stringify` round-tripping.
 */
@Injectable()
export class CachingAnalyticsQueryRepository implements AnalyticsQueryPort {
  constructor(
    private readonly inner: PrismaAnalyticsQueryRepository,
    private readonly cache: RedisQueryCache,
  ) {}

  getReservationSummary(scope: AnalyticsRestaurantScope): Promise<ReservationSummaryRawData> {
    return this.cache.getOrSet(
      `analytics:reservation-summary:${JSON.stringify(scope)}`,
      TTL_SECONDS,
      () => this.inner.getReservationSummary(scope),
    );
  }

  getReservationTrends(scope: AnalyticsBranchScope): Promise<DayBucketCounts> {
    return this.cache.getOrSet(
      `analytics:reservation-trends:${JSON.stringify(scope)}`,
      TTL_SECONDS,
      () => this.inner.getReservationTrends(scope),
      dayBucketCountsCodec,
    );
  }

  getPeakHours(scope: AnalyticsBranchScope): Promise<Map<number, number>> {
    return this.cache.getOrSet(
      `analytics:peak-hours:${JSON.stringify(scope)}`,
      TTL_SECONDS,
      () => this.inner.getPeakHours(scope),
      peakHoursCodec,
    );
  }

  getCustomerInsights(scope: AnalyticsRestaurantScope): Promise<CustomerInsightsRawData> {
    return this.cache.getOrSet(
      `analytics:customer-insights:${JSON.stringify(scope)}`,
      TTL_SECONDS,
      () => this.inner.getCustomerInsights(scope),
    );
  }

  getWaitlistCounts(scope: AnalyticsRestaurantScope): Promise<WaitlistStatusCounts> {
    return this.cache.getOrSet(
      `analytics:waitlist-counts:${JSON.stringify(scope)}`,
      TTL_SECONDS,
      () => this.inner.getWaitlistCounts(scope),
    );
  }

  getReviewsSummary(restaurantId: string): Promise<ReviewsSummaryRawData> {
    return this.cache.getOrSet(`analytics:reviews-summary:${restaurantId}`, TTL_SECONDS, () =>
      this.inner.getReviewsSummary(restaurantId),
    );
  }
}
