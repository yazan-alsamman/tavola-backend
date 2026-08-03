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
  /** Phase 15 (Optimization) batch accessor - all images for all given Reviews, ordered by `sortOrder` ascending within each Review, soft-deleted rows excluded. Empty input returns `[]` without a database round-trip. */
  findManyByReviewIds(reviewIds: ReviewId[]): Promise<ReviewImage[]>;
  countByReviewId(reviewId: ReviewId): Promise<number>;
  softDelete(id: ReviewImageId, at: Date): Promise<void>;
}

export const REVIEW_IMAGE_REPOSITORY = Symbol('REVIEW_IMAGE_REPOSITORY');
