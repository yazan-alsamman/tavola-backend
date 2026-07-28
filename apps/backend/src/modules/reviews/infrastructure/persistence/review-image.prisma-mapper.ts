import { ReviewImage as PrismaReviewImage } from '@prisma/client';
import { ReviewImage as ReviewImageEntity } from '../../domain/entities/review-image.entity';

export class ReviewImagePrismaMapper {
  static toDomain(row: PrismaReviewImage): ReviewImageEntity {
    return ReviewImageEntity.reconstitute({
      id: row.id,
      reviewId: row.reviewId,
      fileId: row.fileId,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt,
      deletedAt: row.deletedAt,
    });
  }

  static toPersistence(image: ReviewImageEntity): PrismaReviewImage {
    const props = image.toProps();
    return {
      id: props.id,
      reviewId: props.reviewId,
      fileId: props.fileId,
      sortOrder: props.sortOrder,
      createdAt: props.createdAt,
      deletedAt: props.deletedAt,
    };
  }
}
