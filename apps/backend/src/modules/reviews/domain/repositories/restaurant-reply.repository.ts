import { RestaurantReply } from '../entities/restaurant-reply.entity';
import { ReviewId } from '@shared/domain/value-objects/identifiers.vo';

export interface RestaurantReplyRepository {
  /** Throws `ReviewAlreadyRepliedException` if the database's own
   *  `UNIQUE(reviewId)` constraint rejects a losing concurrent insert
   *  (P2002) - zero-or-one reply per review is authoritative at the
   *  database level, never a pre-check alone. */
  create(reply: RestaurantReply): Promise<void>;
  findByReviewId(reviewId: ReviewId): Promise<RestaurantReply | null>;
}

export const RESTAURANT_REPLY_REPOSITORY = Symbol('RESTAURANT_REPLY_REPOSITORY');
