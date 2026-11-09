import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import {
  ReviewId,
  RestaurantId,
  ReservationId,
  UserId,
} from '@shared/domain/value-objects/identifiers.vo';
import { Review } from '../../domain/entities/review.entity';
import {
  ReviewListFilter,
  ReviewListPage,
  ReviewRepository,
} from '../../domain/repositories/review.repository';
import { ReviewAlreadyExistsException } from '../../domain/exceptions/review-already-exists.exception';
import { ReviewPrismaMapper } from './review.prisma-mapper';

const AXIS_COLUMN = {
  service: 'serviceRating',
  place: 'placeRating',
  food: 'foodRating',
} as const;

function starsWhere(filter: ReviewListFilter): Prisma.ReviewWhereInput {
  if (filter.axis !== undefined) {
    const column = AXIS_COLUMN[filter.axis];
    return filter.stars !== undefined ? { [column]: filter.stars } : { [column]: { not: null } };
  }
  return filter.stars !== undefined ? { rating: filter.stars } : {};
}

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

/**
 * `Review` carries no `organizationId` column and is not in
 * `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS` (TENANCY.md, Phase 10
 * architecture freeze) - this repository provides no tenant isolation by
 * itself; see `ReviewRepository`'s own doc comment for the full reasoning
 * and the `existsPubliclyById`-style caveat this module's use cases already
 * account for via `RestaurantRepository`.
 */
@Injectable()
export class PrismaReviewRepository implements ReviewRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async create(review: Review): Promise<void> {
    const data = ReviewPrismaMapper.toPersistence(review);
    try {
      await this.prismaContext.client.review.create({ data });
    } catch (error) {
      if (violatesUniqueColumn(error, 'reservation_id')) {
        throw new ReviewAlreadyExistsException();
      }
      throw error;
    }
  }

  async findById(id: ReviewId): Promise<Review | null> {
    const row = await this.prismaContext.client.review.findFirst({
      where: { id: id.value, deletedAt: null },
    });
    return row ? ReviewPrismaMapper.toDomain(row) : null;
  }

  async findByReservationId(reservationId: ReservationId): Promise<Review | null> {
    const row = await this.prismaContext.client.review.findFirst({
      where: { reservationId: reservationId.value, deletedAt: null },
    });
    return row ? ReviewPrismaMapper.toDomain(row) : null;
  }

  async findManyByRestaurantId(
    restaurantId: RestaurantId,
    page: number,
    limit: number,
    filter: ReviewListFilter = {},
  ): Promise<ReviewListPage> {
    const where: Prisma.ReviewWhereInput = {
      restaurantId: restaurantId.value,
      deletedAt: null,
      ...starsWhere(filter),
    };
    const [rows, total] = await Promise.all([
      this.prismaContext.client.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaContext.client.review.count({ where }),
    ]);
    return { items: rows.map(ReviewPrismaMapper.toDomain), total };
  }

  async findManyByUserId(userId: UserId, page: number, limit: number): Promise<ReviewListPage> {
    const [rows, total] = await Promise.all([
      this.prismaContext.client.review.findMany({
        where: { userId: userId.value, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaContext.client.review.count({ where: { userId: userId.value, deletedAt: null } }),
    ]);
    return { items: rows.map(ReviewPrismaMapper.toDomain), total };
  }

  async update(review: Review): Promise<void> {
    const row = ReviewPrismaMapper.toPersistence(review);
    await this.prismaContext.client.review.updateMany({
      where: { id: row.id, deletedAt: null },
      data: {
        rating: row.rating,
        comment: row.comment,
        score: row.score,
        serviceRating: row.serviceRating,
        placeRating: row.placeRating,
        foodRating: row.foodRating,
        serviceComment: row.serviceComment,
        placeComment: row.placeComment,
        foodComment: row.foodComment,
        privateNote: row.privateNote,
        reopenedAt: row.reopenedAt,
        reratedAt: row.reratedAt,
        updatedAt: row.updatedAt,
      },
    });
  }

  async softDelete(id: ReviewId, at: Date): Promise<void> {
    await this.prismaContext.client.review.updateMany({
      where: { id: id.value, deletedAt: null },
      data: { deletedAt: at, updatedAt: at },
    });
  }
}
