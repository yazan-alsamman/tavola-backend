import { Review } from '@modules/reviews/domain/entities/review.entity';
import {
  ReviewListPage,
  ReviewRepository,
} from '@modules/reviews/domain/repositories/review.repository';
import { ReviewAlreadyExistsException } from '@modules/reviews/domain/exceptions/review-already-exists.exception';
import {
  ReviewId,
  RestaurantId,
  ReservationId,
  UserId,
} from '@shared/domain/value-objects/identifiers.vo';

export class InMemoryReviewRepository implements ReviewRepository {
  private readonly rows = new Map<string, Review>();

  async create(review: Review): Promise<void> {
    for (const existing of this.rows.values()) {
      if (
        existing.reviewId.value !== review.reviewId.value &&
        existing.reservationId.value === review.reservationId.value
      ) {
        throw new ReviewAlreadyExistsException();
      }
    }
    this.rows.set(review.reviewId.value, review);
  }

  async findById(id: ReviewId): Promise<Review | null> {
    const review = this.rows.get(id.value);
    if (!review || review.isDeleted()) {
      return null;
    }
    return review;
  }

  async findByReservationId(reservationId: ReservationId): Promise<Review | null> {
    for (const review of this.rows.values()) {
      if (review.reservationId.value === reservationId.value && !review.isDeleted()) {
        return review;
      }
    }
    return null;
  }

  async findManyByRestaurantId(
    restaurantId: RestaurantId,
    page: number,
    limit: number,
  ): Promise<ReviewListPage> {
    const active = [...this.rows.values()]
      .filter((review) => review.restaurantId.value === restaurantId.value && !review.isDeleted())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (page - 1) * limit;
    return { items: active.slice(start, start + limit), total: active.length };
  }

  async findManyByUserId(userId: UserId, page: number, limit: number): Promise<ReviewListPage> {
    const active = [...this.rows.values()]
      .filter((review) => review.userId.value === userId.value && !review.isDeleted())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (page - 1) * limit;
    return { items: active.slice(start, start + limit), total: active.length };
  }

  async softDelete(id: ReviewId, at: Date): Promise<void> {
    const existing = this.rows.get(id.value);
    if (existing && !existing.isDeleted()) {
      this.rows.set(id.value, existing.softDelete(at));
    }
  }

  /** Test-only wiring: feeds `InMemoryRestaurantRepository.recomputeAverageRating`
   *  the same active-review data the real Prisma implementation computes
   *  from the `reviews` table directly. */
  listAllForAverageRating(): { restaurantId: string; rating: number; deletedAt: Date | null }[] {
    return [...this.rows.values()].map((review) => ({
      restaurantId: review.restaurantId.value,
      rating: review.rating,
      deletedAt: review.deletedAt,
    }));
  }

  seed(review: Review): void {
    this.rows.set(review.reviewId.value, review);
  }
}
