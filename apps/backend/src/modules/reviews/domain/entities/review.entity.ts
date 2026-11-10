import { Entity } from '@shared/domain/base/entity.base';
import {
  ReviewId,
  UserId,
  RestaurantId,
  ReservationId,
} from '@shared/domain/value-objects/identifiers.vo';
import { InvalidReviewException } from '../exceptions/invalid-review.exception';
import { ReviewNotReopenedException } from '../exceptions/review-not-reopened.exception';

/** The three things a guest rates after a visit (CR WJ-R-2026-002, ADR-045). */
export const REVIEW_AXES = ['service', 'place', 'food'] as const;
export type ReviewAxis = (typeof REVIEW_AXES)[number];

export interface ReviewAxisRating {
  rating: number;
  comment: string | null;
}

export type ReviewAxes = Record<ReviewAxis, ReviewAxisRating>;

export interface ReviewProps {
  id: string;
  userId: string;
  restaurantId: string;
  reservationId: string;
  /** Whole stars, kept for app 1.0.2: the rounded score for a three-axis review. */
  rating: number;
  comment: string | null;
  /** Average of the three axes (two decimals), or `rating` for a single-rating review. */
  score: number;
  axes: ReviewAxes | null;
  privateNote: string | null;
  reopenedAt: Date | null;
  reratedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ReviewContent {
  /** Required without axes; ignored (derived) when axes are given. */
  rating?: number | null;
  comment: string | null;
  axes?: ReviewAxes | null;
  privateNote?: string | null;
}

const MIN_RATING = 1;
const MAX_RATING = 5;

/**
 * Review Aggregate root (Phase 10; three axes and re-rating, ADR-045).
 * The guest writes it once. It changes again only when the restaurant opens
 * it for re-rating (`reopen`) and the guest then rates again (`rerate`).
 * The restaurant never edits or deletes it.
 */
export class Review extends Entity<ReviewProps> {
  private constructor(props: ReviewProps) {
    super(props);
  }

  static create(
    props: ReviewContent & {
      id: string;
      userId: string;
      restaurantId: string;
      reservationId: string;
      now: Date;
    },
  ): Review {
    const content = resolveContent(props);
    return new Review({
      id: props.id,
      userId: props.userId,
      restaurantId: props.restaurantId,
      reservationId: props.reservationId,
      ...content,
      reopenedAt: null,
      reratedAt: null,
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

  get score(): number {
    return this.props.score;
  }

  get axes(): ReviewAxes | null {
    return this.props.axes ? cloneAxes(this.props.axes) : null;
  }

  get privateNote(): string | null {
    return this.props.privateNote;
  }

  get reopenedAt(): Date | null {
    return this.props.reopenedAt ? new Date(this.props.reopenedAt.getTime()) : null;
  }

  get reratedAt(): Date | null {
    return this.props.reratedAt ? new Date(this.props.reratedAt.getTime()) : null;
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

  isOpenForRerating(): boolean {
    return this.props.reopenedAt !== null;
  }

  /**
   * The restaurant opens the review for the guest to rate again, after
   * talking to them. Opening it again while already open keeps the first
   * opening time.
   */
  reopen(at: Date): Review {
    if (this.props.reopenedAt !== null) {
      return this;
    }
    return Review.reconstitute({ ...this.props, reopenedAt: at, updatedAt: at });
  }

  /** The guest's new rating replaces the old one and closes the re-rating window. */
  rerate(content: ReviewContent, at: Date): Review {
    if (this.props.reopenedAt === null) {
      throw new ReviewNotReopenedException();
    }
    return Review.reconstitute({
      ...this.props,
      ...resolveContent(content),
      reopenedAt: null,
      reratedAt: at,
      updatedAt: at,
    });
  }

  /**
   * Soft delete only. Only the guest who wrote the review may delete it
   * (`assertActorCanDeleteReview`); this method performs the transition.
   */
  softDelete(at: Date): Review {
    return Review.reconstitute({
      ...this.props,
      deletedAt: at,
      updatedAt: at,
    });
  }

  toProps(): Readonly<ReviewProps> {
    return { ...this.props, axes: this.props.axes ? cloneAxes(this.props.axes) : null };
  }
}

function resolveContent(
  content: ReviewContent,
): Pick<ReviewProps, 'rating' | 'comment' | 'score' | 'axes' | 'privateNote'> {
  const privateNote = content.privateNote ?? null;
  if (content.axes) {
    for (const axis of REVIEW_AXES) {
      validateRating(content.axes[axis].rating, `${axis} rating`);
    }
    const score = scoreOf(content.axes);
    return {
      rating: Math.min(MAX_RATING, Math.max(MIN_RATING, Math.round(score))),
      comment: content.comment,
      score,
      axes: cloneAxes(content.axes),
      privateNote,
    };
  }
  if (content.rating === undefined || content.rating === null) {
    throw new InvalidReviewException('rating is required when the review has no axes.');
  }
  validateRating(content.rating, 'rating');
  return {
    rating: content.rating,
    comment: content.comment,
    score: content.rating,
    axes: null,
    privateNote,
  };
}

/** The review's score: the plain average of its three axes, to two decimals. */
export function scoreOf(axes: ReviewAxes): number {
  const sum = REVIEW_AXES.reduce((total, axis) => total + axes[axis].rating, 0);
  return Math.round((sum / REVIEW_AXES.length) * 100) / 100;
}

function cloneAxes(axes: ReviewAxes): ReviewAxes {
  return {
    service: { ...axes.service },
    place: { ...axes.place },
    food: { ...axes.food },
  };
}

function validateRating(rating: number, label: string): void {
  if (!Number.isInteger(rating)) {
    throw new InvalidReviewException(`${label} must be an integer.`);
  }
  if (rating < MIN_RATING || rating > MAX_RATING) {
    throw new InvalidReviewException(
      `${label} must be between ${MIN_RATING} and ${MAX_RATING} inclusive.`,
    );
  }
}
