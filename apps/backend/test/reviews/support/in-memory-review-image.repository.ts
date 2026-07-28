import { ReviewImage } from '@modules/reviews/domain/entities/review-image.entity';
import { ReviewImageRepository } from '@modules/reviews/domain/repositories/review-image.repository';
import { ReviewImageId, ReviewId } from '@shared/domain/value-objects/identifiers.vo';

export class InMemoryReviewImageRepository implements ReviewImageRepository {
  private readonly rows = new Map<string, ReviewImage>();

  async create(image: ReviewImage): Promise<void> {
    this.rows.set(image.reviewImageId.value, image);
  }

  async findById(id: ReviewImageId): Promise<ReviewImage | null> {
    const image = this.rows.get(id.value);
    if (!image || image.isDeleted()) {
      return null;
    }
    return image;
  }

  async findManyByReviewId(reviewId: ReviewId): Promise<ReviewImage[]> {
    return [...this.rows.values()]
      .filter((image) => image.reviewId.value === reviewId.value && !image.isDeleted())
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async countByReviewId(reviewId: ReviewId): Promise<number> {
    return (await this.findManyByReviewId(reviewId)).length;
  }

  async softDelete(id: ReviewImageId, at: Date): Promise<void> {
    const existing = this.rows.get(id.value);
    if (existing && !existing.isDeleted()) {
      this.rows.set(id.value, existing.softDelete(at));
    }
  }
}
