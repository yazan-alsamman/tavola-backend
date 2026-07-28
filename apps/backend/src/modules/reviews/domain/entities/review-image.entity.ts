import { Entity } from '@shared/domain/base/entity.base';
import { ReviewImageId, ReviewId, FileId } from '@shared/domain/value-objects/identifiers.vo';
import { InvalidReviewImageException } from '../exceptions/invalid-review-image.exception';

export interface ReviewImageProps {
  id: string;
  reviewId: string;
  fileId: string;
  sortOrder: number;
  createdAt: Date;
  deletedAt: Date | null;
}

/**
 * One image attached to a Review (Phase 10, architecture frozen
 * 2026-07-26). Reuses the Files/MinIO pipeline exactly like
 * `RestaurantGalleryImage` reuses it for `FileOwnerType.Restaurant` - this
 * entity is the join/ordering row, `FileRecord` (Files module) remains the
 * sole owner of the file's storage metadata. Add/remove only - no caption or
 * reorder capability (matching `RestaurantGalleryImage`'s own precedent);
 * individual deletion (owner decision #16) is the only post-create mutation.
 */
export class ReviewImage extends Entity<ReviewImageProps> {
  private constructor(props: ReviewImageProps) {
    super(props);
  }

  static create(props: ReviewImageProps): ReviewImage {
    validate(props);
    return new ReviewImage({ ...props });
  }

  static reconstitute(props: ReviewImageProps): ReviewImage {
    return new ReviewImage({ ...props });
  }

  get reviewImageId(): ReviewImageId {
    return ReviewImageId.create(this.props.id);
  }

  get reviewId(): ReviewId {
    return ReviewId.create(this.props.reviewId);
  }

  get fileId(): FileId {
    return FileId.create(this.props.fileId);
  }

  get sortOrder(): number {
    return this.props.sortOrder;
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }

  get deletedAt(): Date | null {
    return this.props.deletedAt ? new Date(this.props.deletedAt.getTime()) : null;
  }

  isDeleted(): boolean {
    return this.props.deletedAt !== null;
  }

  softDelete(at: Date): ReviewImage {
    return ReviewImage.reconstitute({
      ...this.props,
      deletedAt: at,
    });
  }

  toProps(): Readonly<ReviewImageProps> {
    return { ...this.props };
  }
}

function validate(props: ReviewImageProps): void {
  if (props.reviewId.trim().length === 0) {
    throw new InvalidReviewImageException('ReviewImage must have a reviewId.');
  }
  if (props.fileId.trim().length === 0) {
    throw new InvalidReviewImageException('ReviewImage must have a fileId.');
  }
  if (!Number.isInteger(props.sortOrder) || props.sortOrder < 0) {
    throw new InvalidReviewImageException('sortOrder must be a non-negative integer.');
  }
}
