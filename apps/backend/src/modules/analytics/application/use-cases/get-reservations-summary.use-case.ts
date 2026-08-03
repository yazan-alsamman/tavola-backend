import { Inject, Injectable } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import {
  ANALYTICS_QUERY_PORT,
  AnalyticsQueryPort,
  AnalyticsRestaurantScope,
} from '../ports/analytics-query.port';
import { ResolveAnalyticsScopeService } from '../services/resolve-analytics-scope.service';
import { ResolveAnalyticsDateRangeService } from '../services/resolve-analytics-date-range.service';
import { AnalyticsDateRangeQuery } from '../dto/analytics-date-range.dto';
import { ReservationSummaryResult } from '../dto/reservation-summary.result';
import { computeAverage, computeRatio } from '../../domain/services/analytics-formulas';

export interface GetReservationsSummaryForRestaurantCommand {
  actor: AuthenticatedActor;
  restaurantId: string;
  branchId?: string;
  range: AnalyticsDateRangeQuery;
}

export interface GetReservationsSummaryForOrganizationCommand {
  actor: AuthenticatedActor;
  range: AnalyticsDateRangeQuery;
}

/**
 * Phase 14 (Analytics, ADR-028). Restaurant/Organization-scope Reservation
 * Summary - status counts, source breakdown, the three rates, average party
 * size. No timezone bucketing (Decision #4), so both scopes share this one
 * use case, differing only in how many `restaurantId`s the resolved scope
 * carries (organization aggregates every Restaurant the actor's tenant
 * context resolves; restaurant scope carries exactly one).
 */
@Injectable()
export class GetReservationsSummaryUseCase {
  constructor(
    @Inject(ANALYTICS_QUERY_PORT) private readonly analyticsQueryPort: AnalyticsQueryPort,
    private readonly resolveScope: ResolveAnalyticsScopeService,
    private readonly resolveDateRange: ResolveAnalyticsDateRangeService,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async executeForRestaurant(
    command: GetReservationsSummaryForRestaurantCommand,
  ): Promise<ReservationSummaryResult> {
    const resolved = await this.resolveScope.resolveRestaurantScope(
      command.actor,
      command.restaurantId,
      command.branchId,
    );
    return this.buildResult(
      { restaurantIds: [resolved.restaurantId], branchIds: resolved.branchIds },
      command.range,
    );
  }

  async executeForOrganization(
    command: GetReservationsSummaryForOrganizationCommand,
  ): Promise<ReservationSummaryResult> {
    const resolved = await this.resolveScope.resolveOrganizationScope(command.actor);
    return this.buildResult(
      { restaurantIds: resolved.restaurantIds, branchIds: null },
      command.range,
    );
  }

  private async buildResult(
    tenantScope: { restaurantIds: string[]; branchIds: string[] | null },
    rangeQuery: AnalyticsDateRangeQuery,
  ): Promise<ReservationSummaryResult> {
    const range = this.resolveDateRange.resolve(rangeQuery, null, this.clock.now());
    const scope: AnalyticsRestaurantScope = { ...tenantScope, range };

    const raw = await this.analyticsQueryPort.getReservationSummary(scope);

    return {
      statusCounts: raw.statusCounts,
      sourceBreakdown: raw.sourceCounts,
      completionRate: computeRatio(
        raw.statusCounts.Completed,
        raw.statusCounts.Completed + raw.statusCounts.NoShow,
      ),
      noShowRate: computeRatio(
        raw.statusCounts.NoShow,
        raw.statusCounts.Completed + raw.statusCounts.NoShow,
      ),
      cancellationRate: computeRatio(
        raw.cancelledFromApprovedCount,
        raw.cancelledFromApprovedCount + raw.statusCounts.Completed + raw.statusCounts.NoShow,
      ),
      avgPartySize: computeAverage(raw.partySizeSum, raw.partySizeCount),
      generatedAt: this.clock.now().toISOString(),
    };
  }
}
