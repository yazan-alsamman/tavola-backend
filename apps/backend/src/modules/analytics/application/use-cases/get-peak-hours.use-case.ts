import { Inject, Injectable } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { ANALYTICS_QUERY_PORT, AnalyticsQueryPort } from '../ports/analytics-query.port';
import { ResolveAnalyticsScopeService } from '../services/resolve-analytics-scope.service';
import { ResolveAnalyticsDateRangeService } from '../services/resolve-analytics-date-range.service';
import { AnalyticsDateRangeQuery } from '../dto/analytics-date-range.dto';
import { PeakHoursResult } from '../dto/peak-hours.result';
import { zeroFillHourBuckets } from '../../domain/services/analytics-formulas';

export interface GetPeakHoursCommand {
  actor: AuthenticatedActor;
  restaurantId: string;
  branchId: string;
  range: AnalyticsDateRangeQuery;
}

/**
 * Phase 14 (Analytics, ADR-028 Decision #10/D11). Branch-scope only - 24
 * Branch-local hourly buckets of `reservationStartTime`, restricted to
 * Approved/Completed/NoShow (Pending/Rejected/Expired/Cancelled excluded).
 * Never described or exposed as an occupancy metric (ADR-028 Decision #10).
 */
@Injectable()
export class GetPeakHoursUseCase {
  constructor(
    @Inject(ANALYTICS_QUERY_PORT) private readonly analyticsQueryPort: AnalyticsQueryPort,
    private readonly resolveScope: ResolveAnalyticsScopeService,
    private readonly resolveDateRange: ResolveAnalyticsDateRangeService,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(command: GetPeakHoursCommand): Promise<PeakHoursResult> {
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

    const counts = await this.analyticsQueryPort.getPeakHours({
      branchId: branchScope.branchId,
      timezone: branchScope.timezone,
      range,
    });

    return {
      peakHours: zeroFillHourBuckets(counts),
      generatedAt: this.clock.now().toISOString(),
    };
  }
}
