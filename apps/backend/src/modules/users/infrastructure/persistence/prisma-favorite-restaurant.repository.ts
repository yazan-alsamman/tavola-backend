import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { UserId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  FavoriteRestaurantPage,
  FavoriteRestaurantRepository,
} from '../../domain/repositories/favorite-restaurant.repository';
import { FavoriteRestaurant } from '../../domain/entities/favorite-restaurant.entity';
import { FavoriteRestaurantPrismaMapper } from './favorite-restaurant.prisma-mapper';

function isUniqueFavoriteViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Injects `PrismaContext` (the standard tenant-scoped client), not the raw
 * `PrismaService` - `Favorite` is deliberately NOT in the tenant-scoping
 * extension's `DIRECT_TENANT_OWNED_MODELS` allowlist (see the model's own
 * doc comment in schema.prisma), so `withTenantScoping` is a verified no-op
 * passthrough for it, per `PrismaContext`'s own doc comment. This is safe
 * because every query here is scoped by the caller's own verified `userId`.
 */
@Injectable()
export class PrismaFavoriteRestaurantRepository implements FavoriteRestaurantRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async add(favorite: FavoriteRestaurant): Promise<FavoriteRestaurant> {
    const data = FavoriteRestaurantPrismaMapper.toPersistence(favorite);
    try {
      const row = await this.prismaContext.client.favorite.create({ data });
      return FavoriteRestaurantPrismaMapper.toDomain(row);
    } catch (error) {
      if (!isUniqueFavoriteViolation(error)) {
        throw error;
      }
      // Concurrent duplicate add: the database's own unique(userId,
      // restaurantId) constraint is the final concurrency invariant (never
      // a prior exists()-then-insert race) - return the already-existing
      // row instead of surfacing an error, matching this repository's
      // documented idempotent contract.
      const existing = await this.prismaContext.client.favorite.findUnique({
        where: {
          userId_restaurantId: { userId: data.userId, restaurantId: data.restaurantId },
        },
      });
      if (existing === null) {
        throw error;
      }
      return FavoriteRestaurantPrismaMapper.toDomain(existing);
    }
  }

  async remove(userId: UserId, restaurantId: RestaurantId): Promise<void> {
    await this.prismaContext.client.favorite.deleteMany({
      where: { userId: userId.value, restaurantId: restaurantId.value },
    });
  }

  async findByUserAndRestaurant(
    userId: UserId,
    restaurantId: RestaurantId,
  ): Promise<FavoriteRestaurant | null> {
    const row = await this.prismaContext.client.favorite.findUnique({
      where: {
        userId_restaurantId: { userId: userId.value, restaurantId: restaurantId.value },
      },
    });
    return row ? FavoriteRestaurantPrismaMapper.toDomain(row) : null;
  }

  async listByUser(userId: UserId, page: number, limit: number): Promise<FavoriteRestaurantPage> {
    const where = { userId: userId.value };
    const [rows, total] = await Promise.all([
      this.prismaContext.client.favorite.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaContext.client.favorite.count({ where }),
    ]);

    return {
      items: rows.map((row) => FavoriteRestaurantPrismaMapper.toDomain(row)),
      total,
    };
  }

  async deleteAllByUserId(userId: UserId): Promise<void> {
    await this.prismaContext.client.favorite.deleteMany({ where: { userId: userId.value } });
  }
}
