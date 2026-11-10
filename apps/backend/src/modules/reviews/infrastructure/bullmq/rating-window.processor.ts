import { Processor, WorkerHost } from '@nestjs/bullmq';
import { RecomputeRestaurantRatingsUseCase } from '../../application/use-cases/recompute-restaurant-ratings.use-case';
import { RATING_WINDOW_QUEUE_NAME } from './rating-window-queue.constants';

/** Sole consumer of `RestaurantRatingWindowQueue`; no business logic of its own. */
@Processor(RATING_WINDOW_QUEUE_NAME)
export class RatingWindowProcessor extends WorkerHost {
  constructor(private readonly recomputeRestaurantRatings: RecomputeRestaurantRatingsUseCase) {
    super();
  }

  async process(): Promise<{ updated: number }> {
    return this.recomputeRestaurantRatings.execute();
  }
}
