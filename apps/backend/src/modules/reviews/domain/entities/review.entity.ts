import { Entity } from '@shared/domain/base/entity.base';
import {
  ReviewId,
  UserId,
  RestaurantId,
  ReservationId,
} from '@shared/domain/value-objects/identifiers.vo';
import { InvalidReviewException } from '../exceptions/invalid-review.exception';

export interface ReviewProps {
  id: string;
  userId: string;
  restaurantId: string;
  reservationId: string;
  rating: number;
  comment: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

const MIN_RATING = 1;
const MAX_RATING = 5;

/**
 * Review Aggregate root (Phase 10, architecture frozen 2026-07-26,
 * TASKS.md's "Phase 10 — Reviews: Pre-implementation architecture
 * decisions"). Immutable after creation - `rating`/`comment` are set once at
 * `create()` and never changed by any later method; there is no
 * `updateXxx()` here, mirroring `RestaurantGalleryImage`'s own "add/remove
 * only" precedent, deliberately (owner decision: Reviews are immutable, no
 * `ReviewUpdated` event exists). `deletedAt` (soft delete, ADR-010) is the
 * only post-create mutation this entity supports.
 */
export class Review extends Entity<ReviewProps> {
  private constructor(props: ReviewProps) {
    super(props);
  }

  static create(props: {
    id: string;
    userId: string;
    restaurantId: string;
    reservationId: string;
    rating: number;
    comment: string | null;
    now: Date;
  }): Review {
    validate(props.rating);
    return new Review({
      id: props.id,
      userId: props.userId,
      restaurantId: props.restaurantId,
      reservationId: props.reservationId,
      rating: props.rating,
      comment: props.comment,
      createdAt: props.now,
      updatedAt: props.now,
      deletedAt: null,
    });
  }

  static reconstitute(props: ReviewProps): Review {
    return new Review({ ...props });
  }

  get reviewId(): ReviewId {
    return ReviewId.create(this.props.id);
  }

  get userId(): UserId {
    return UserId.create(this.props.userId);
  }

  get restaurantId(): RestaurantId {
    return RestaurantId.create(this.props.restaurantId);
  }

  get reservationId(): ReservationId {
    return ReservationId.create(this.props.reservationId);
  }

  get rating(): number {
    return this.props.rating;
  }

  get comment(): string | null {
    return this.props.comment;
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }

  get updatedAt(): Date {
    return new Date(this.props.updatedAt.getTime());
  }

  get deletedAt(): Date | null {
    return this.props.deletedAt ? new Date(this.props.deletedAt.getTime()) : null;
  }

  isDeleted(): boolean {
    return this.props.deletedAt !== null;
  }

  /**
   * Owner decision #7/#8/#9: soft delete only, reachable by either the
   * owning Customer or a Restaurant Organization Owner/Admin - actor
   * resolution/authorization happens in the application layer
   * (`assertActorCanDeleteReview`), never here; this method only performs
   * the state transition itself, unconditionally, once authorized.
   */
  softDelete(at: Date): Review {
    return Review.reconstitute({
      ...this.props,
      deletedAt: at,
      updatedAt: at,
    });
  }

  toProps(): Readonly<ReviewProps> {
    return { ...this.props };
  }
}

function validate(rating: number): void {
  if (!Number.isInteger(rating)) {
    throw new InvalidReviewException('rating must be an integer.');
  }
  if (rating < MIN_RATING || rating > MAX_RATING) {
    throw new InvalidReviewException(
      `rating must be between ${MIN_RATING} and ${MAX_RATING} inclusive.`,
    );
  }
}
