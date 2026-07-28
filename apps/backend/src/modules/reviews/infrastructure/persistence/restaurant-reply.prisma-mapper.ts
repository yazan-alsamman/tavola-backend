import { RestaurantReply as PrismaRestaurantReply } from '@prisma/client';
import { RestaurantReply as RestaurantReplyEntity } from '../../domain/entities/restaurant-reply.entity';

export class RestaurantReplyPrismaMapper {
  static toDomain(row: PrismaRestaurantReply): RestaurantReplyEntity {
    return RestaurantReplyEntity.reconstitute({
      id: row.id,
      reviewId: row.reviewId,
      repliedByUserId: row.repliedByUserId,
      comment: row.comment,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  static toPersistence(reply: RestaurantReplyEntity): PrismaRestaurantReply {
    const props = reply.toProps();
    return {
      id: props.id,
      reviewId: props.reviewId,
      repliedByUserId: props.repliedByUserId,
      comment: props.comment,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
    };
  }
}
