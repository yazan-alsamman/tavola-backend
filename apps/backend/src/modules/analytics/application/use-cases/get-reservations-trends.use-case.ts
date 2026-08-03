import { Inject, Injectable } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { ANALYTICS_QUERY_PORT, AnalyticsQueryPort } from '../ports/analytics-query.port';
import { ResolveAnalyticsScopeService } from '../services/resolve-analytics-scope.service';
import { ResolveAnalyticsDateRangeService } from '../services/resolve-analytics-date-range.service';
import { AnalyticsDateRangeQuery } from '../dto/analytics-date-range.dto';
import { ReservationTrendsResult } from '../dto/reservation-trends.result';
import { zeroFillDayBuckets } from '../../domain/services/analytics-formulas';

export interface GetReservationsTrendsCommand {
  actor: AuthenticatedActor;
  restaurantId: string;
  branchId: string;
  range: AnalyticsDateRangeQuery;
}

/**
 * Phase 14 (Analytics, ADR-028 Decision #3/#4). Branch-scope only - service-
 * day trend buckets by `reservationStartTime AT TIME ZONE Branch.timezone`,
 * booking-created trend buckets by `createdAt AT TIME ZONE Branch.timezone`.
 * Neither ever reads the stored `Reservation.reservationDate` column, which
 * ADR-028's Context proved is not reliably Branch-local.
 */
@Injectable()
export class GetReservationsTrendsUseCase {
  constructor(
    @Inject(ANALYTICS_QUERY_PORT) private readonly analyticsQueryPort: AnalyticsQueryPort,
    private readonly resolveScope: ResolveAnalyticsScopeService,
    private readonly resolveDateRange: ResolveAnalyticsDateRangeService,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(command: GetReservationsTrendsCommand): Promise<ReservationTrendsResult> {
    const branchScope = await this.resolveScope.resolveBranchScope(
      command.actor,
      command.restaurantId,
      command.branchId,
    );
    const range = this.resolveDateRange.resolve(
      command.range,
      branchScope.timezone,
      this.clock.now(),
    );

    const raw = await this.analyticsQueryPort.getReservationTrends({
      branchId: branchScope.branchId,
      timezone: branchScope.timezone,
      range,
    });

    return {
      serviceDayTrend: zeroFillDayBuckets(range.fromKey, range.toKey, raw.serviceDayCounts),
      bookingCreatedTrend: zeroFillDayBuckets(range.fromKey, range.toKey, raw.bookingCreatedCounts),
      generatedAt: this.clock.now().toISOString(),
    };
  }
}
