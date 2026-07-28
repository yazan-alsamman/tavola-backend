import { ReviewImage } from '../entities/review-image.entity';
import { ReviewImageId, ReviewId } from '@shared/domain/value-objects/identifiers.vo';

/**
 * Every method here excludes soft-deleted rows (`deletedAt: null`) - a
 * second delete attempt on an already-removed image collapses to "not
 * found", matching `Review`/`Table`'s own soft-delete precedent.
 */
export interface ReviewImageRepository {
  create(image: ReviewImage): Promise<void>;
  findById(id: ReviewImageId): Promise<ReviewImage | null>;
  /** Ordered by `sortOrder` ascending. */
  findManyByReviewId(reviewId: ReviewId): Promise<ReviewImage[]>;
  countByReviewId(reviewId: ReviewId): Promise<number>;
  softDelete(id: ReviewImageId, at: Date): Promise<void>;
}

export const REVIEW_IMAGE_REPOSITORY = Symbol('REVIEW_IMAGE_REPOSITORY');
