import { Inject, Injectable } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { ANALYTICS_QUERY_PORT, AnalyticsQueryPort } from '../ports/analytics-query.port';
import { ResolveAnalyticsScopeService } from '../services/resolve-analytics-scope.service';
import { ResolveAnalyticsDateRangeService } from '../services/resolve-analytics-date-range.service';
import { AnalyticsDateRangeQuery } from '../dto/analytics-date-range.dto';
import { WaitlistAnalyticsResult } from '../dto/waitlist-analytics.result';
import { computeRatio } from '../../domain/services/analytics-formulas';

export interface GetWaitlistAnalyticsCommand {
  actor: AuthenticatedActor;
  restaurantId: string;
  branchId?: string;
  range: AnalyticsDateRangeQuery;
}

/**
 * Phase 14 (Analytics, ADR-028 Decision #2/D16). `waitlistConversionRate =
 * Converted / (Converted + Cancelled + Expired)` - Waiting/Notified excluded
 * from the denominator (open entries have no outcome yet). Range field is
 * `ReservationWaitlistEntry.createdAt` (the entry's workflow-entry time; no
 * `joinedAt` field exists on this model).
 */
@Injectable()
export class GetWaitlistAnalyticsUseCase {
  constructor(
    @Inject(ANALYTICS_QUERY_PORT) private readonly analyticsQueryPort: AnalyticsQueryPort,
    private readonly resolveScope: ResolveAnalyticsScopeService,
    private readonly resolveDateRange: ResolveAnalyticsDateRangeService,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(command: GetWaitlistAnalyticsCommand): Promise<WaitlistAnalyticsResult> {
    const resolved = await this.resolveScope.resolveRestaurantScope(
      command.actor,
      command.restaurantId,
      command.branchId,
    );
    const range = this.resolveDateRange.resolve(command.range, null, this.clock.now());

    const counts = await this.analyticsQueryPort.getWaitlistCounts({
      restaurantIds: [resolved.restaurantId],
      branchIds: resolved.branchIds,
      range,
    });

    return {
      waitlistEntries: counts,
      waitlistConversionRate: computeRatio(
        counts.Converted,
        counts.Converted + counts.Cancelled + counts.Expired,
      ),
      generatedAt: this.clock.now().toISOString(),
    };
  }
}
