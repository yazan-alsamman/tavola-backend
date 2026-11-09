import { Prisma, Review as PrismaReview } from '@prisma/client';
import { Review as ReviewEntity, ReviewAxes } from '../../domain/entities/review.entity';

function axesOf(row: PrismaReview): ReviewAxes | null {
  if (row.serviceRating === null || row.placeRating === null || row.foodRating === null) {
    return null;
  }
  return {
    service: { rating: row.serviceRating, comment: row.serviceComment },
    place: { rating: row.placeRating, comment: row.placeComment },
    food: { rating: row.foodRating, comment: row.foodComment },
  };
}

export class ReviewPrismaMapper {
  static toDomain(row: PrismaReview): ReviewEntity {
    return ReviewEntity.reconstitute({
      id: row.id,
      userId: row.userId,
      restaurantId: row.restaurantId,
      reservationId: row.reservationId,
      rating: row.rating,
      comment: row.comment,
      score: row.score.toNumber(),
      axes: axesOf(row),
      privateNote: row.privateNote,
      reopenedAt: row.reopenedAt,
      reratedAt: row.reratedAt,
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
      score: new Prisma.Decimal(props.score),
      serviceRating: props.axes?.service.rating ?? null,
      placeRating: props.axes?.place.rating ?? null,
      foodRating: props.axes?.food.rating ?? null,
      serviceComment: props.axes?.service.comment ?? null,
      placeComment: props.axes?.place.comment ?? null,
      foodComment: props.axes?.food.comment ?? null,
      privateNote: props.privateNote,
      reopenedAt: props.reopenedAt,
      reratedAt: props.reratedAt,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
      deletedAt: props.deletedAt,
    };
  }
}
