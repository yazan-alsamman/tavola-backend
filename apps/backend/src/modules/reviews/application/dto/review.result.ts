import { ReviewAxes } from '../../domain/entities/review.entity';

export interface ReviewImageResult {
  reviewImageId: string;
  imageUrl: string;
  sortOrder: number;
}

export interface RestaurantReplyResult {
  comment: string;
  createdAt: Date;
}

/**
 * Public projection-ready shape (Phase 10, owner decision #14): carries
 * `reviewerUsername` only - never `userId`, real name, phone, email, or any
 * `ReservationGuest`/internal identifier. `null` when the underlying User
 * has no username set (Owner/staff-created accounts have none - ADR-022
 * Customer registration is the only path that sets one; an edge case, not
 * an error).
 */
export interface ReviewResult {
  reviewId: string;
  restaurantId: string;
  reservationId: string;
  reviewerUsername: string | null;
  rating: number;
  comment: string | null;
  /** Average of the three axes, or `rating` for a single-rating review. */
  score: number;
  axes: ReviewAxes | null;
  /** For the restaurant only - the public projection drops it. */
  privateNote: string | null;
  /** The restaurant opened the review; the guest may rate again. */
  openForRerating: boolean;
  reratedAt: Date | null;
  images: ReviewImageResult[];
  reply: RestaurantReplyResult | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReviewListResult {
  items: ReviewResult[];
  page: number;
  limit: number;
  total: number;
}
