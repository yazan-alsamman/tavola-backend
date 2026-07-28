import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { ReviewId } from '@shared/domain/value-objects/identifiers.vo';
import { RestaurantReply } from '../../domain/entities/restaurant-reply.entity';
import { RestaurantReplyRepository } from '../../domain/repositories/restaurant-reply.repository';
import { ReviewAlreadyRepliedException } from '../../domain/exceptions/review-already-replied.exception';
import { RestaurantReplyPrismaMapper } from './restaurant-reply.prisma-mapper';

function violatesUniqueColumn(error: unknown, column: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.includes(column);
  }
  return typeof target === 'string' && target.includes(column);
}

@Injectable()
export class PrismaRestaurantReplyRepository implements RestaurantReplyRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async create(reply: RestaurantReply): Promise<void> {
    const data = RestaurantReplyPrismaMapper.toPersistence(reply);
    try {
      await this.prismaContext.client.restaurantReply.create({ data });
    } catch (error) {
      if (violatesUniqueColumn(error, 'review_id')) {
        throw new ReviewAlreadyRepliedException();
      }
      throw error;
    }
  }

  async findByReviewId(reviewId: ReviewId): Promise<RestaurantReply | null> {
    const row = await this.prismaContext.client.restaurantReply.findFirst({
      where: { reviewId: reviewId.value },
    });
    return row ? RestaurantReplyPrismaMapper.toDomain(row) : null;
  }
}
