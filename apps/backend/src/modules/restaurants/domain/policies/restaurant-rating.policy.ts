/**
 * ADR-045 (CR WJ-R-2026-002): a restaurant's rating is the average review
 * score of the last 6 months, shown to guests only from 5 reviews (fewer
 * reads "new on Tavola"; none shows nothing).
 */
export const RATING_WINDOW_MONTHS = 6;

export const RATING_MIN_REVIEWS = 5;

/** The earliest `createdAt` a review may have to count towards the rating at `at`. */
export function ratingWindowStart(at: Date): Date {
  const start = new Date(at.getTime());
  start.setUTCMonth(start.getUTCMonth() - RATING_WINDOW_MONTHS);
  return start;
}
