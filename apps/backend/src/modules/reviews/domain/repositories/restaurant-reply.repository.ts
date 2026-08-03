import { RestaurantReply } from '../entities/restaurant-reply.entity';
import { ReviewId } from '@shared/domain/value-objects/identifiers.vo';

export interface RestaurantReplyRepository {
  /** Throws `ReviewAlreadyRepliedException` if the database's own
   *  `UNIQUE(reviewId)` constraint rejects a losing concurrent insert
   *  (P2002) - zero-or-one reply per review is authoritative at the
   *  database level, never a pre-check alone. */
  create(reply: RestaurantReply): Promise<void>;
  findByReviewId(reviewId: ReviewId): Promise<RestaurantReply | null>;
  /** Phase 15 (Optimization) batch accessor - at most one reply per Review, order not guaranteed. Empty input returns `[]` without a database round-trip. */
  findManyByReviewIds(reviewIds: ReviewId[]): Promise<RestaurantReply[]>;
}

export const RESTAURANT_REPLY_REPOSITORY = Symbol('RESTAURANT_REPLY_REPOSITORY');
