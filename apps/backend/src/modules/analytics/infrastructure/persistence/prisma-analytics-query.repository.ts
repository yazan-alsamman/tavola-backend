import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import {
  AnalyticsBranchScope,
  AnalyticsQueryPort,
  AnalyticsRestaurantScope,
  CustomerInsightsRawData,
  DayBucketCounts,
  ReservationSourceCounts,
  ReservationStatusCounts,
  ReservationSummaryRawData,
  ReviewsSummaryRawData,
  WaitlistStatusCounts,
} from '../../application/ports/analytics-query.port';

const EMPTY_STATUS_COUNTS: ReservationStatusCounts = {
  Pending: 0,
  Approved: 0,
  Rejected: 0,
  Cancelled: 0,
  Completed: 0,
  Expired: 0,
  NoShow: 0,
};

const EMPTY_SOURCE_COUNTS: ReservationSourceCounts = {
  Online: 0,
  Phone: 0,
  WalkIn: 0,
  Staff: 0,
  WaitlistConversion: 0,
};

const EMPTY_WAITLIST_COUNTS: WaitlistStatusCounts = {
  Waiting: 0,
  Notified: 0,
  Converted: 0,
  Cancelled: 0,
  Expired: 0,
};

/**
 * Phase 14 (Analytics, ADR-028). Direct PostgreSQL reads over existing
 * operational tables only - no Analytics persistence model. Restaurant/
 * Organization-scope aggregates (status counts, source breakdown, rates,
 * customer insights, waitlist, reviews) use Prisma's typed `groupBy`/
 * `aggregate`/`count` (no timezone conversion needed - these are
 * timezone-agnostic by construction, ADR-028 Decision #4). Branch-scoped
 * bucketed series (service-day trend, booking-created trend, Peak Hours)
 * require per-row IANA timezone conversion (`AT TIME ZONE`), which Prisma's
 * query builder cannot express, so those three use parameterized raw SQL
 * against the `reservations` table - the same `$queryRaw`/tagged-template
 * pattern already used elsewhere in this codebase for what the query builder
 * cannot express (e.g. `prisma-reservation.repository.ts`'s advisory lock).
 */
@Injectable()
export class PrismaAnalyticsQueryRepository implements AnalyticsQueryPort {
  constructor(private readonly prismaContext: PrismaContext) {}

  async getReservationSummary(scope: AnalyticsRestaurantScope): Promise<ReservationSummaryRawData> {
    const where = this.buildReservationWhere(scope);

    const [statusGroups, sourceGroups, cancelledFromApprovedCount, partyAgg] = await Promise.all([
      this.prismaContext.client.reservation.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prismaContext.client.reservation.groupBy({
        by: ['source'],
        where,
        _count: { _all: true },
      }),
      this.prismaContext.client.reservation.count({
        where: { ...where, status: 'Cancelled', approvedAt: { not: null } },
      }),
      this.prismaContext.client.reservation.aggregate({
        where,
        _sum: { guests: true },
        _count: { guests: true },
      }),
    ]);

    const statusCounts = { ...EMPTY_STATUS_COUNTS };
    for (const group of statusGroups) {
      statusCounts[group.status as keyof ReservationStatusCounts] = group._count._all;
    }
    const sourceCounts = { ...EMPTY_SOURCE_COUNTS };
    for (const group of sourceGroups) {
      sourceCounts[group.source as keyof ReservationSourceCounts] = group._count._all;
    }

    return {
      statusCounts,
      sourceCounts,
      cancelledFromApprovedCount,
      partySizeSum: partyAgg._sum.guests ?? 0,
      partySizeCount: partyAgg._count.guests,
    };
  }

  async getReservationTrends(scope: AnalyticsBranchScope): Promise<DayBucketCounts> {
    const [serviceDayRows, bookingCreatedRows] = await Promise.all([
      this.prismaContext.client.$queryRaw<Array<{ bucket: Date; count: bigint }>>(Prisma.sql`
        SELECT (reservation_start_time AT TIME ZONE ${scope.timezone})::date AS bucket, COUNT(*) AS count
        FROM reservations
        WHERE branch_id = ${scope.branchId}::uuid
          AND reservation_start_time >= ${scope.range.from}
          AND reservation_start_time <= ${scope.range.to}
        GROUP BY bucket
      `),
      this.prismaContext.client.$queryRaw<Array<{ bucket: Date; count: bigint }>>(Prisma.sql`
        SELECT (created_at AT TIME ZONE ${scope.timezone})::date AS bucket, COUNT(*) AS count
        FROM reservations
        WHERE branch_id = ${scope.branchId}::uuid
          AND created_at >= ${scope.range.from}
          AND created_at <= ${scope.range.to}
        GROUP BY bucket
      `),
    ]);

    return {
      serviceDayCounts: toDateKeyCountMap(serviceDayRows),
      bookingCreatedCounts: toDateKeyCountMap(bookingCreatedRows),
    };
  }

  async getPeakHours(scope: AnalyticsBranchScope): Promise<Map<number, number>> {
    const rows = await this.prismaContext.client.$queryRaw<Array<{ hour: number; count: bigint }>>(
      Prisma.sql`
        SELECT EXTRACT(HOUR FROM (reservation_start_time AT TIME ZONE ${scope.timezone}))::int AS hour,
               COUNT(*) AS count
        FROM reservations
        WHERE branch_id = ${scope.branchId}::uuid
          AND reservation_start_time >= ${scope.range.from}
          AND reservation_start_time <= ${scope.range.to}
          AND status IN ('Approved', 'Completed', 'NoShow')
        GROUP BY hour
      `,
    );
    const counts = new Map<number, number>();
    for (const row of rows) {
      counts.set(Number(row.hour), Number(row.count));
    }
    return counts;
  }

  async getCustomerInsights(scope: AnalyticsRestaurantScope): Promise<CustomerInsightsRawData> {
    const where = this.buildReservationWhere(scope);

    const [userGroups, guestBackedReservationCount, partyAgg] = await Promise.all([
      this.prismaContext.client.reservation.groupBy({
        by: ['userId'],
        where: { ...where, userId: { not: null } },
        _count: { _all: true },
      }),
      this.prismaContext.client.reservation.count({
        where: { ...where, reservationGuestId: { not: null } },
      }),
      this.prismaContext.client.reservation.aggregate({
        where,
        _sum: { guests: true },
        _count: { guests: true },
      }),
    ]);

    return {
      uniqueRegisteredCustomers: userGroups.length,
      returningRegisteredCustomers: userGroups.filter((group) => group._count._all >= 2).length,
      guestBackedReservationCount,
      partySizeSum: partyAgg._sum.guests ?? 0,
      partySizeCount: partyAgg._count.guests,
    };
  }

  async getWaitlistCounts(scope: AnalyticsRestaurantScope): Promise<WaitlistStatusCounts> {
    const groups = await this.prismaContext.client.reservationWaitlistEntry.groupBy({
      by: ['status'],
      where: {
        restaurantId: { in: scope.restaurantIds },
        branchId: scope.branchIds ? { in: scope.branchIds } : undefined,
        createdAt: { gte: scope.range.from, lte: scope.range.to },
        deletedAt: null,
      },
      _count: { _all: true },
    });

    const counts = { ...EMPTY_WAITLIST_COUNTS };
    for (const group of groups) {
      counts[group.status as keyof WaitlistStatusCounts] = group._count._all;
    }
    return counts;
  }

  async getReviewsSummary(restaurantId: string): Promise<ReviewsSummaryRawData> {
    const activeReviewCount = await this.prismaContext.client.review.count({
      where: { restaurantId, deletedAt: null },
    });
    return { activeReviewCount };
  }

  private buildReservationWhere(scope: AnalyticsRestaurantScope): Prisma.ReservationWhereInput {
    return {
      restaurantId: { in: scope.restaurantIds },
      branchId: scope.branchIds ? { in: scope.branchIds } : undefined,
      createdAt: { gte: scope.range.from, lte: scope.range.to },
    };
  }
}

function toDateKeyCountMap(rows: Array<{ bucket: Date; count: bigint }>): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const bucket = row.bucket instanceof Date ? row.bucket : new Date(row.bucket);
    const key = bucket.toISOString().slice(0, 10);
    map.set(key, Number(row.count));
  }
  return map;
}
