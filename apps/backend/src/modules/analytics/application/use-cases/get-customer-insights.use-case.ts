import { Inject, Injectable } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { ANALYTICS_QUERY_PORT, AnalyticsQueryPort } from '../ports/analytics-query.port';
import { ResolveAnalyticsScopeService } from '../services/resolve-analytics-scope.service';
import { ResolveAnalyticsDateRangeService } from '../services/resolve-analytics-date-range.service';
import { AnalyticsDateRangeQuery } from '../dto/analytics-date-range.dto';
import { CustomerInsightsResult } from '../dto/customer-insights.result';
import { computeAverage } from '../../domain/services/analytics-formulas';

export interface GetCustomerInsightsCommand {
  actor: AuthenticatedActor;
  restaurantId: string;
  branchId?: string;
  range: AnalyticsDateRangeQuery;
}

/**
 * Phase 14 (Analytics, ADR-028 Decision #2/D12/D13). Registered-customer
 * identity is `Reservation.userId` / `User.id`; "returning" is range-scoped
 * (>= 2 qualifying reservations within the requested range, not lifetime -
 * ADR-028 reconciliation). Guest-backed reservations are exposed only as an
 * aggregate count - guest identity is never merged, never listed.
 */
@Injectable()
export class GetCustomerInsightsUseCase {
  constructor(
    @Inject(ANALYTICS_QUERY_PORT) private readonly analyticsQueryPort: AnalyticsQueryPort,
    private readonly resolveScope: ResolveAnalyticsScopeService,
    private readonly resolveDateRange: ResolveAnalyticsDateRangeService,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(command: GetCustomerInsightsCommand): Promise<CustomerInsightsResult> {
    const resolved = await this.resolveScope.resolveRestaurantScope(
      command.actor,
      command.restaurantId,
      command.branchId,
    );
    const range = this.resolveDateRange.resolve(command.range, null, this.clock.now());

    const raw = await this.analyticsQueryPort.getCustomerInsights({
      restaurantIds: [resolved.restaurantId],
      branchIds: resolved.branchIds,
      range,
    });

    return {
      uniqueRegisteredCustomers: raw.uniqueRegisteredCustomers,
      returningRegisteredCustomers: raw.returningRegisteredCustomers,
      guestBackedReservationCount: raw.guestBackedReservationCount,
      avgPartySize: computeAverage(raw.partySizeSum, raw.partySizeCount),
      generatedAt: this.clock.now().toISOString(),
    };
  }
}
