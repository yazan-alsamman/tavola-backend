import { Review as PrismaReview } from '@prisma/client';
import { Review as ReviewEntity } from '../../domain/entities/review.entity';

export class ReviewPrismaMapper {
  static toDomain(row: PrismaReview): ReviewEntity {
    return ReviewEntity.reconstitute({
      id: row.id,
      userId: row.userId,
      restaurantId: row.restaurantId,
      reservationId: row.reservationId,
      rating: row.rating,
      comment: row.comment,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    });
  }

  static toPersistence(review: ReviewEntity): PrismaReview {
    const props = review.toProps();
    return {
      id: props.id,
      userId: props.userId,
      restaurantId: props.restaurantId,
      reservationId: props.reservationId,
      rating: props.rating,
      comment: props.comment,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
      deletedAt: props.deletedAt,
    };
  }
}
