import { Inject, Injectable } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { ANALYTICS_QUERY_PORT, AnalyticsQueryPort } from '../ports/analytics-query.port';
import { assertActorCanViewAnalytics } from '../services/assert-actor-can-view-analytics';
import { ReviewsSummaryResult } from '../dto/reviews-summary.result';

export interface GetReviewsSummaryCommand {
  actor: AuthenticatedActor;
  restaurantId: string;
}

/**
 * Phase 14 (Analytics, ADR-028 Decision #2/D17). Restaurant scope only - no
 * Branch narrowing (Reviews are Restaurant-level, per Phase 10). Reuses
 * Phase 10's own `Restaurant.averageRating` and active-review-count
 * semantics exactly (`deletedAt IS NULL`) - no new review analytics.
 */
@Injectable()
export class GetReviewsSummaryUseCase {
  constructor(
    @Inject(ANALYTICS_QUERY_PORT) private readonly analyticsQueryPort: AnalyticsQueryPort,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(command: GetReviewsSummaryCommand): Promise<ReviewsSummaryResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    assertActorCanViewAnalytics(command.actor, restaurant.restaurantId.value, null);

    const raw = await this.analyticsQueryPort.getReviewsSummary(restaurant.restaurantId.value);

    return {
      activeReviewCount: raw.activeReviewCount,
      averageRating: restaurant.averageRating,
      generatedAt: this.clock.now().toISOString(),
    };
  }
}
