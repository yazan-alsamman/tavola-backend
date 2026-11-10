import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';

/**
 * ADR-045: the restaurant rating covers the last 6 months, so it changes as
 * reviews age out even when nobody reviews. This daily sweep slides every
 * restaurant's window forward; submit/delete/re-rate keep it current between
 * sweeps.
 */
@Injectable()
export class RecomputeRestaurantRatingsUseCase {
  private readonly logger = new Logger(RecomputeRestaurantRatingsUseCase.name);

  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(): Promise<{ updated: number }> {
    const updated = await this.restaurantRepository.recomputeAllRatings(this.clock.now());
    if (updated > 0) {
      this.logger.log(`Restaurant ratings recomputed: ${updated} changed.`);
    }
    return { updated };
  }
}
