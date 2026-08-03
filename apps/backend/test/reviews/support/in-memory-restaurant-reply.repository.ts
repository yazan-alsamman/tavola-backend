import { RestaurantReply } from '@modules/reviews/domain/entities/restaurant-reply.entity';
import { RestaurantReplyRepository } from '@modules/reviews/domain/repositories/restaurant-reply.repository';
import { ReviewAlreadyRepliedException } from '@modules/reviews/domain/exceptions/review-already-replied.exception';
import { ReviewId } from '@shared/domain/value-objects/identifiers.vo';

export class InMemoryRestaurantReplyRepository implements RestaurantReplyRepository {
  private readonly rows = new Map<string, RestaurantReply>();

  async create(reply: RestaurantReply): Promise<void> {
    for (const existing of this.rows.values()) {
      if (existing.reviewId.value === reply.reviewId.value) {
        throw new ReviewAlreadyRepliedException();
      }
    }
    this.rows.set(reply.restaurantReplyId.value, reply);
  }

  async findByReviewId(reviewId: ReviewId): Promise<RestaurantReply | null> {
    for (const reply of this.rows.values()) {
      if (reply.reviewId.value === reviewId.value) {
        return reply;
      }
    }
    return null;
  }

  async findManyByReviewIds(reviewIds: ReviewId[]): Promise<RestaurantReply[]> {
    if (reviewIds.length === 0) {
      return [];
    }
    const uniqueIds = new Set(reviewIds.map((id) => id.value));
    return [...this.rows.values()].filter((reply) => uniqueIds.has(reply.reviewId.value));
  }
}
