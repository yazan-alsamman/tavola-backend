/**
 * ADR-045 - the daily sweep that slides each restaurant's 6-month rating
 * window (`RecomputeRestaurantRatingsUseCase`). One job scheduler, upserted
 * at boot, so restarts and multiple API instances never stack schedules.
 */
export const RATING_WINDOW_QUEUE_NAME = 'RestaurantRatingWindowQueue';

export const RATING_WINDOW_JOB_NAME = 'restaurant-rating-window-sweep';

export const RATING_WINDOW_SCHEDULER_ID = 'restaurant-rating-window';

/** Every day at 03:15 UTC. */
export const RATING_WINDOW_CRON = '15 3 * * *';
