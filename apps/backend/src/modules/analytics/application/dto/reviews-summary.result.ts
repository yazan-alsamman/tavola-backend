import { ReviewAxis } from '@modules/reviews/domain/entities/review.entity';

export interface ReviewsSummaryResult {
  /** Every active review, all time. */
  activeReviewCount: number;
  /** The real average score of the last 6 months; null with no reviews there (ADR-045). */
  averageRating: number | null;
  /** Active reviews in the last 6 months. */
  windowReviewCount: number;
  /** Fewer than 5 reviews in the window: guests see "new on Tavola" instead of stars. */
  isNew: boolean;
  /** Per-axis averages over the window's three-axis reviews; null with none. */
  axisAverages: Record<ReviewAxis, number | null>;
  /** Highlighted to guests ("great place" / "great service"); null without axis reviews. */
  strongestAxis: ReviewAxis | null;
  /** For the monthly report; null without axis reviews. */
  weakestAxis: ReviewAxis | null;
  generatedAt: string;
}
