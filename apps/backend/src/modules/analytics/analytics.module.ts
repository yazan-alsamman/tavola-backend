import { Module } from '@nestjs/common';
import { PrismaModule } from '@infrastructure/prisma/prisma.module';
import { AuthenticationModule } from '@modules/authentication/authentication.module';
import { RestaurantsModule } from '@modules/restaurants/restaurants.module';
import { BranchesModule } from '@modules/branches/branches.module';
import { GetReservationsSummaryUseCase } from './application/use-cases/get-reservations-summary.use-case';
import { GetReservationsTrendsUseCase } from './application/use-cases/get-reservations-trends.use-case';
import { GetPeakHoursUseCase } from './application/use-cases/get-peak-hours.use-case';
import { GetCustomerInsightsUseCase } from './application/use-cases/get-customer-insights.use-case';
import { GetWaitlistAnalyticsUseCase } from './application/use-cases/get-waitlist-analytics.use-case';
import { GetReviewsSummaryUseCase } from './application/use-cases/get-reviews-summary.use-case';
import { ResolveAnalyticsScopeService } from './application/services/resolve-analytics-scope.service';
import { ResolveAnalyticsDateRangeService } from './application/services/resolve-analytics-date-range.service';
import { ANALYTICS_QUERY_PORT } from './application/ports/analytics-query.port';
import { PrismaAnalyticsQueryRepository } from './infrastructure/persistence/prisma-analytics-query.repository';
import { CachingAnalyticsQueryRepository } from './infrastructure/persistence/caching-analytics-query.repository';
import { AnalyticsController } from './presentation/controllers/analytics.controller';
import { OrganizationAnalyticsController } from './presentation/controllers/organization-analytics.controller';

/**
 * Phase 14 (Analytics, architecture frozen 2026-07-28, ADR-028). Read-only
 * query module - `Controller -> Query Use Case -> AnalyticsQueryPort ->
 * Prisma`. Depends on `AuthenticationModule` for `CLOCK` (the only shared
 * token this module needs - no `ID_GENERATOR`/`EVENT_PUBLISHER`/
 * `UNIT_OF_WORK`, since Analytics never writes) and
 * `JwtAuthGuard`/`SessionVersionGuard`; `RestaurantsModule`/`BranchesModule`
 * for `RESTAURANT_REPOSITORY`/`BRANCH_REPOSITORY` (tenant resolution,
 * identical to `BranchesController`'s own "resolve the parent Restaurant
 * through the already-tenant-scoped repository first" pattern). No
 * Analytics persistence model, so no repository token to export - only
 * `ANALYTICS_QUERY_PORT`, bound to the Prisma implementation.
 */
@Module({
  imports: [PrismaModule, AuthenticationModule, RestaurantsModule, BranchesModule],
  controllers: [AnalyticsController, OrganizationAnalyticsController],
  providers: [
    GetReservationsSummaryUseCase,
    GetReservationsTrendsUseCase,
    GetPeakHoursUseCase,
    GetCustomerInsightsUseCase,
    GetWaitlistAnalyticsUseCase,
    GetReviewsSummaryUseCase,
    ResolveAnalyticsScopeService,
    ResolveAnalyticsDateRangeService,
    PrismaAnalyticsQueryRepository,
    CachingAnalyticsQueryRepository,
    // Post-Audit Remediation (2026-08-02, L7): ANALYTICS_QUERY_PORT now
    // resolves to the caching decorator (60s TTL, no write-side
    // invalidation), which itself wraps PrismaAnalyticsQueryRepository
    // directly - see that class's own doc comment.
    { provide: ANALYTICS_QUERY_PORT, useExisting: CachingAnalyticsQueryRepository },
  ],
})
export class AnalyticsModule {}
