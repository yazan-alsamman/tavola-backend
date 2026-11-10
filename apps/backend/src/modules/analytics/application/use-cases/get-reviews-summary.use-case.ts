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
import {
  RATING_MIN_REVIEWS,
  ratingWindowStart,
} from '@modules/restaurants/domain/policies/restaurant-rating.policy';
import { REVIEW_AXES, ReviewAxis } from '@modules/reviews/domain/entities/review.entity';

export interface GetReviewsSummaryCommand {
  actor: AuthenticatedActor;
  restaurantId: string;
}

/**
 * Phase 14 (Analytics, ADR-028), reworked by ADR-045. Restaurant scope only
 * (reviews are restaurant-level). The average is computed from the real
 * reviews of the last 6 months - never the persisted public
 * `Restaurant.averageRating`, which hides below 5 reviews and once showed a
 * stale 4.6 for a restaurant with none.
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

    const now = this.clock.now();
    const raw = await this.analyticsQueryPort.getReviewsSummary(
      restaurant.restaurantId.value,
      ratingWindowStart(now),
    );

    return {
      activeReviewCount: raw.activeReviewCount,
      averageRating: raw.windowAverage,
      windowReviewCount: raw.windowReviewCount,
      isNew: raw.windowReviewCount < RATING_MIN_REVIEWS,
      axisAverages: { ...raw.axisAverages },
      strongestAxis: pickAxis(raw.axisAverages, (a, b) => a > b),
      weakestAxis: pickAxis(raw.axisAverages, (a, b) => a < b),
      generatedAt: now.toISOString(),
    };
  }
}

/** The axis whose average wins `better` (first in REVIEW_AXES order on a tie); null with none. */
function pickAxis(
  averages: Record<ReviewAxis, number | null>,
  better: (candidate: number, current: number) => boolean,
): ReviewAxis | null {
  let picked: ReviewAxis | null = null;
  for (const axis of REVIEW_AXES) {
    const value = averages[axis];
    if (value === null) {
      continue;
    }
    const current = picked === null ? null : averages[picked];
    if (current === null || current === undefined || better(value, current)) {
      picked = axis;
    }
  }
  return picked;
}
