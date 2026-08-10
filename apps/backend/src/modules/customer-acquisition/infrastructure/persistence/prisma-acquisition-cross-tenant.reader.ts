import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import {
  AcquisitionCrossTenantReaderPort,
  ExportAcquisitionRawRow,
  RevenueReportRawBucket,
} from '../../application/ports/acquisition-cross-tenant-reader.port';
import { RevenueReportGroupBy } from '../../application/dto/get-revenue-report.command';

/**
 * ADR-035 Pattern 2 (Tenant-Agnostic Raw Reader) - Revenue Reporting and
 * Export both aggregate/list across every Restaurant/Organization at once,
 * exactly the "future platform-wide aggregation such as a Dashboard or
 * Revenue Report" TENANCY.md's own Pattern 2 section names as the canonical
 * example. Deliberately injects the raw `PrismaService` instead of
 * `PrismaContext`, mirroring `PrismaPlatformAdminRestaurantLookupReader`'s
 * own justification - added by name to `.eslintrc.js`'s
 * `no-restricted-imports` `excludedFiles` whitelist. Per Pattern 2's DTO
 * requirement, every row/bucket includes `organizationId`/`restaurantId` -
 * the Platform Back Office case, not the customer-facing DTO-stripping
 * convention.
 *
 * Prisma's typed `groupBy` cannot express a `JOIN` (needed for Organization
 * grouping, since `customer_acquisitions` carries no `organizationId`
 * column) or a date-truncation `GROUP BY` (day/week/month/quarter/year) -
 * both use parameterized raw SQL, the same `$queryRaw` escape hatch already
 * used elsewhere in this codebase for what the query builder cannot express
 * (`PrismaAnalyticsQueryRepository`'s own doc comment, `prisma-reservation.repository.ts`'s
 * advisory lock). `groupBy`'s SQL fragment is selected from a fixed,
 * TypeScript-union-typed whitelist switch, never interpolated from raw
 * client input - no injection surface.
 */
@Injectable()
export class PrismaAcquisitionCrossTenantReader implements AcquisitionCrossTenantReaderPort {
  constructor(private readonly prisma: PrismaService) {}

  async groupByRevenue(params: {
    from: Date;
    to: Date;
    groupBy: RevenueReportGroupBy;
    restaurantId?: string;
    organizationId?: string;
  }): Promise<RevenueReportRawBucket[]> {
    const keyExpr = this.groupByKeyExpression(params.groupBy);
    const scopeFilter = this.scopeFilterSql(params.restaurantId, params.organizationId);

    const rows = await this.prisma.$queryRaw<
      Array<{
        bucket_key: string;
        currency: string;
        recorded_count: bigint;
        recorded_total: Prisma.Decimal | null;
        reversed_count: bigint;
        reversed_total: Prisma.Decimal | null;
      }>
    >(Prisma.sql`
      SELECT
        ${keyExpr} AS bucket_key,
        ca.fee_currency AS currency,
        COUNT(*) FILTER (WHERE ca.recorded_at >= ${params.from} AND ca.recorded_at < ${params.to}) AS recorded_count,
        COALESCE(SUM(ca.fee_amount) FILTER (WHERE ca.recorded_at >= ${params.from} AND ca.recorded_at < ${params.to}), 0) AS recorded_total,
        COUNT(*) FILTER (WHERE ca.status = 'Reversed' AND ca.reversed_at >= ${params.from} AND ca.reversed_at < ${params.to}) AS reversed_count,
        COALESCE(SUM(ca.fee_amount) FILTER (WHERE ca.status = 'Reversed' AND ca.reversed_at >= ${params.from} AND ca.reversed_at < ${params.to}), 0) AS reversed_total
      FROM customer_acquisitions ca
      INNER JOIN restaurants r ON r.id = ca.restaurant_id
      WHERE
        (
          (ca.recorded_at >= ${params.from} AND ca.recorded_at < ${params.to})
          OR (ca.status = 'Reversed' AND ca.reversed_at >= ${params.from} AND ca.reversed_at < ${params.to})
        )
        ${scopeFilter}
      GROUP BY bucket_key, ca.fee_currency
      ORDER BY bucket_key ASC
    `);

    return rows.map((row) => ({
      key: row.bucket_key,
      currency: row.currency,
      recordedCount: Number(row.recorded_count),
      recordedTotal: row.recorded_total
        ? (row.recorded_total.toNumber?.() ?? Number(row.recorded_total))
        : 0,
      reversedCount: Number(row.reversed_count),
      reversedTotal: row.reversed_total
        ? (row.reversed_total.toNumber?.() ?? Number(row.reversed_total))
        : 0,
    }));
  }

  async exportAcquisitions(params: {
    from: Date;
    to: Date;
    restaurantId?: string;
    organizationId?: string;
  }): Promise<ExportAcquisitionRawRow[]> {
    const scopeFilter = this.scopeFilterSql(params.restaurantId, params.organizationId);

    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        restaurant_id: string;
        organization_id: string;
        user_id: string | null;
        reservation_guest_id: string | null;
        created_via: string;
        status: string;
        fee_amount: Prisma.Decimal;
        fee_currency: string;
        recorded_at: Date;
        reversed_at: Date | null;
      }>
    >(Prisma.sql`
      SELECT
        ca.id, ca.restaurant_id, r.organization_id, ca.user_id, ca.reservation_guest_id,
        ca.created_via, ca.status, ca.fee_amount, ca.fee_currency, ca.recorded_at, ca.reversed_at
      FROM customer_acquisitions ca
      INNER JOIN restaurants r ON r.id = ca.restaurant_id
      WHERE ca.recorded_at >= ${params.from} AND ca.recorded_at < ${params.to}
        ${scopeFilter}
      ORDER BY ca.recorded_at ASC
    `);

    return rows.map((row) => ({
      id: row.id,
      restaurantId: row.restaurant_id,
      organizationId: row.organization_id,
      userId: row.user_id,
      reservationGuestId: row.reservation_guest_id,
      createdVia: row.created_via,
      status: row.status,
      feeAmount: row.fee_amount.toNumber(),
      feeCurrency: row.fee_currency,
      recordedAt: row.recorded_at,
      reversedAt: row.reversed_at,
    }));
  }

  private scopeFilterSql(restaurantId?: string, organizationId?: string): Prisma.Sql {
    if (restaurantId) {
      return Prisma.sql`AND ca.restaurant_id = ${restaurantId}::uuid`;
    }
    if (organizationId) {
      return Prisma.sql`AND r.organization_id = ${organizationId}::uuid`;
    }
    return Prisma.empty;
  }

  private groupByKeyExpression(groupBy: RevenueReportGroupBy): Prisma.Sql {
    switch (groupBy) {
      case 'day':
        return Prisma.sql`TO_CHAR(DATE_TRUNC('day', COALESCE(ca.recorded_at, ca.reversed_at)), 'YYYY-MM-DD')`;
      case 'week':
        return Prisma.sql`TO_CHAR(DATE_TRUNC('week', COALESCE(ca.recorded_at, ca.reversed_at)), 'YYYY-MM-DD')`;
      case 'month':
        return Prisma.sql`TO_CHAR(DATE_TRUNC('month', COALESCE(ca.recorded_at, ca.reversed_at)), 'YYYY-MM')`;
      case 'quarter':
        return Prisma.sql`TO_CHAR(DATE_TRUNC('quarter', COALESCE(ca.recorded_at, ca.reversed_at)), 'YYYY-"Q"Q')`;
      case 'year':
        return Prisma.sql`TO_CHAR(DATE_TRUNC('year', COALESCE(ca.recorded_at, ca.reversed_at)), 'YYYY')`;
      case 'restaurant':
        return Prisma.sql`ca.restaurant_id::text`;
      case 'organization':
        return Prisma.sql`r.organization_id::text`;
      case 'source':
        return Prisma.sql`COALESCE(ca.reservation_source::text, ca.created_via::text)`;
    }
  }
}
