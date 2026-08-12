import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import {
  PlatformAdminRestaurantLookupReaderPort,
  PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER,
  RestaurantStatusCounts,
} from '@modules/restaurants/application/ports/platform-admin-restaurant-lookup-reader.port';
import {
  PlatformAdminOrganizationStatsReaderPort,
  PLATFORM_ADMIN_ORGANIZATION_STATS_READER,
  OrganizationStatusCounts,
} from '@modules/organizations/application/ports/platform-admin-organization-stats-reader.port';
import {
  PlatformAdminSubscriptionStatsReaderPort,
  PLATFORM_ADMIN_SUBSCRIPTION_STATS_READER,
  SubscriptionStatusCounts,
} from '@modules/subscriptions/application/ports/platform-admin-subscription-stats-reader.port';
import {
  AcquisitionCrossTenantReaderPort,
  ACQUISITION_CROSS_TENANT_READER,
  RevenueReportRawBucket,
} from '@modules/customer-acquisition/application/ports/acquisition-cross-tenant-reader.port';
import {
  NotificationPushStatusCounts,
  PlatformAdminNotificationStatsReaderPort,
  PLATFORM_ADMIN_NOTIFICATION_STATS_READER,
} from '@modules/notifications/application/ports/platform-admin-notification-stats-reader.port';
import { InvalidPlatformDashboardQueryException } from '../../domain/exceptions/invalid-platform-dashboard-query.exception';

const MAX_DASHBOARD_ACQUISITION_RANGE_DAYS = 366;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export interface GetPlatformDashboardQuery {
  from: Date;
  to: Date;
}

export interface AcquisitionCurrencySummary {
  currency: string;
  recordedCount: number;
  recordedTotal: number;
  reversedCount: number;
  reversedTotal: number;
}

export interface PlatformDashboardResult {
  generatedAt: Date;
  restaurants: RestaurantStatusCounts;
  organizations: OrganizationStatusCounts;
  subscriptions: SubscriptionStatusCounts;
  acquisition: {
    from: Date;
    to: Date;
    currencies: AcquisitionCurrencySummary[];
  };
  messaging: NotificationPushStatusCounts;
}

function summarizeByCurrency(buckets: RevenueReportRawBucket[]): AcquisitionCurrencySummary[] {
  const byCurrency = new Map<string, AcquisitionCurrencySummary>();
  for (const bucket of buckets) {
    const existing = byCurrency.get(bucket.currency) ?? {
      currency: bucket.currency,
      recordedCount: 0,
      recordedTotal: 0,
      reversedCount: 0,
      reversedTotal: 0,
    };
    existing.recordedCount += bucket.recordedCount;
    existing.recordedTotal += bucket.recordedTotal;
    existing.reversedCount += bucket.reversedCount;
    existing.reversedTotal += bucket.reversedTotal;
    byCurrency.set(bucket.currency, existing);
  }
  return Array.from(byCurrency.values()).sort((a, b) => a.currency.localeCompare(b.currency));
}

/**
 * Phase 19 — Platform Dashboard composition endpoint (ADR-034 §13/§15,
 * API_GUIDELINES.md's Platform Back Office Route Ownership table: Pattern 2,
 * "Platform Admin module (dashboard composition)"). Pure composition of four
 * already-existing, already-tested read capabilities - no new data-access or
 * business logic of its own, the same shape as `ExportUserDataUseCase`
 * (Phase 3). Every read is genuinely cross-tenant (ADR-035 Pattern 2): no
 * single `organizationId` exists to Explicit-Tenant-Rebind (Pattern 1) to.
 *
 * Restaurant/Organization/Subscription sections are current-state snapshots
 * and therefore ignore `from`/`to` entirely - only the Acquisition/Revenue
 * section is a time-series, so the date range (required, capped at 366 days,
 * mirroring `ListAuditLogsUseCase`/`ExportCustomerAcquisitionsUseCase`'s
 * identical precedent) applies to that section alone. Reuses
 * `AcquisitionCrossTenantReaderPort.groupByRevenue` verbatim (the exact
 * reader `GetRevenueReportUseCase` already uses) and sums the returned
 * buckets by currency in-memory - ADR-033 §17/§22 forbids summing *across*
 * currencies, never summing *within* one, so this is a safe aggregation
 * step, not a new query.
 *
 * Failure semantics: fail-whole, matching every existing composed-read use
 * case in this codebase (no `Promise.allSettled`/partial-result convention
 * exists anywhere in this repository - see Revenue Reporting/Audit Log Read,
 * which behave identically). If any one section's reader throws, the entire
 * request fails.
 *
 * Messaging (Phase 19.6, closing the dependency this class's own doc comment
 * previously disclosed as unimplemented): a platform-wide `pushStatus`
 * count over `Notification`, reusing `PlatformAdminNotificationStatsReaderPort`
 * (ADR-035 Pattern 2 - `Notification` carries no `organizationId` at all,
 * per TENANCY.md). A current-state snapshot like Restaurant/Organization/
 * Subscription (ignores `from`/`to`), not a time-series like Acquisition -
 * `pushStatus` is a per-row current-state field, and no existing frozen
 * date-range contract exists for Notification reporting to reuse.
 */
@Injectable()
export class GetPlatformDashboardUseCase {
  constructor(
    @Inject(PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER)
    private readonly restaurantReader: PlatformAdminRestaurantLookupReaderPort,
    @Inject(PLATFORM_ADMIN_ORGANIZATION_STATS_READER)
    private readonly organizationReader: PlatformAdminOrganizationStatsReaderPort,
    @Inject(PLATFORM_ADMIN_SUBSCRIPTION_STATS_READER)
    private readonly subscriptionReader: PlatformAdminSubscriptionStatsReaderPort,
    @Inject(ACQUISITION_CROSS_TENANT_READER)
    private readonly acquisitionReader: AcquisitionCrossTenantReaderPort,
    @Inject(PLATFORM_ADMIN_NOTIFICATION_STATS_READER)
    private readonly notificationReader: PlatformAdminNotificationStatsReaderPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(query: GetPlatformDashboardQuery): Promise<PlatformDashboardResult> {
    if (query.from.getTime() >= query.to.getTime()) {
      throw new InvalidPlatformDashboardQueryException('from must be strictly before to.');
    }
    const rangeDays = (query.to.getTime() - query.from.getTime()) / MILLISECONDS_PER_DAY;
    if (rangeDays > MAX_DASHBOARD_ACQUISITION_RANGE_DAYS) {
      throw new InvalidPlatformDashboardQueryException(
        `Dashboard query date range must not exceed ${MAX_DASHBOARD_ACQUISITION_RANGE_DAYS} days.`,
      );
    }

    const [restaurants, organizations, subscriptions, acquisitionBuckets, messaging] =
      await Promise.all([
        this.restaurantReader.countByStatus(),
        this.organizationReader.countByStatus(),
        this.subscriptionReader.countByStatus(),
        this.acquisitionReader.groupByRevenue({ from: query.from, to: query.to, groupBy: 'day' }),
        this.notificationReader.countByPushStatus(),
      ]);

    return {
      generatedAt: this.clock.now(),
      restaurants,
      organizations,
      subscriptions,
      acquisition: {
        from: query.from,
        to: query.to,
        currencies: summarizeByCurrency(acquisitionBuckets),
      },
      messaging,
    };
  }
}
