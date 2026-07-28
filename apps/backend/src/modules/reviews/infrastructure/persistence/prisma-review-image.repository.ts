import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { ReviewImageId, ReviewId } from '@shared/domain/value-objects/identifiers.vo';
import { ReviewImage } from '../../domain/entities/review-image.entity';
import { ReviewImageRepository } from '../../domain/repositories/review-image.repository';
import { ReviewImagePrismaMapper } from './review-image.prisma-mapper';

@Injectable()
export class PrismaReviewImageRepository implements ReviewImageRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async create(image: ReviewImage): Promise<void> {
    const data = ReviewImagePrismaMapper.toPersistence(image);
    await this.prismaContext.client.reviewImage.create({ data });
  }

  async findById(id: ReviewImageId): Promise<ReviewImage | null> {
    const row = await this.prismaContext.client.reviewImage.findFirst({
      where: { id: id.value, deletedAt: null },
    });
    return row ? ReviewImagePrismaMapper.toDomain(row) : null;
  }

  async findManyByReviewId(reviewId: ReviewId): Promise<ReviewImage[]> {
    const rows = await this.prismaContext.client.reviewImage.findMany({
      where: { reviewId: reviewId.value, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map(ReviewImagePrismaMapper.toDomain);
  }

  async countByReviewId(reviewId: ReviewId): Promise<number> {
    return this.prismaContext.client.reviewImage.count({
      where: { reviewId: reviewId.value, deletedAt: null },
    });
  }

  async softDelete(id: ReviewImageId, at: Date): Promise<void> {
    await this.prismaContext.client.reviewImage.updateMany({
      where: { id: id.value, deletedAt: null },
      data: { deletedAt: at },
    });
  }
}
