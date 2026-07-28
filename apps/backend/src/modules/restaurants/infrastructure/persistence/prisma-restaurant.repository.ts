import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { RestaurantSlug } from '@shared/domain/value-objects/restaurant-slug.vo';
import { Restaurant } from '../../domain/entities/restaurant.entity';
import {
  RestaurantListPage,
  RestaurantRepository,
} from '../../domain/repositories/restaurant.repository';
import { RestaurantPrismaMapper } from './restaurant.prisma-mapper';

/**
 * No explicit `organizationId` anywhere in this file: `Restaurant` is
 * registered in `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS`
 * (TENANCY.md), so the injected `PrismaContext` client scopes every
 * query/write to the caller's bound tenant automatically, fail-closed if no
 * TenantContext is bound. See `RestaurantRepository`'s own doc comment.
 */
@Injectable()
export class PrismaRestaurantRepository implements RestaurantRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findById(id: RestaurantId): Promise<Restaurant | null> {
    const row = await this.prismaContext.client.restaurant.findFirst({
      where: { id: id.value, deletedAt: null },
    });
    return row ? RestaurantPrismaMapper.toDomain(row) : null;
  }

  async existsBySlug(slug: RestaurantSlug): Promise<boolean> {
    const count = await this.prismaContext.client.restaurant.count({
      where: { slug: slug.value, deletedAt: null },
    });
    return count > 0;
  }

  async findMany(page: number, limit: number): Promise<RestaurantListPage> {
    const [rows, total] = await Promise.all([
      this.prismaContext.client.restaurant.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaContext.client.restaurant.count({ where: { deletedAt: null } }),
    ]);

    return { items: rows.map(RestaurantPrismaMapper.toDomain), total };
  }

  async save(restaurant: Restaurant): Promise<void> {
    const data = RestaurantPrismaMapper.toPersistence(restaurant);
    await this.prismaContext.client.restaurant.upsert({
      where: { id: data.id },
      create: data,
      update: {
        name: data.name,
        logoId: data.logoId,
        coverImageId: data.coverImageId,
        description: data.description,
        cuisineType: data.cuisineType,
        priceLevel: data.priceLevel,
        status: data.status,
        updatedAt: data.updatedAt,
        deletedAt: data.deletedAt,
      },
    });
  }

  /**
   * Phase 10 (Reviews, architecture frozen 2026-07-26). Raw SQL, not the
   * generic Prisma Client query builder - a single atomic `UPDATE ... SET
   * average_rating = (SELECT AVG(...) ...)` statement, so Postgres's own
   * row-level write lock on the target row serializes concurrent recomputes
   * for the SAME restaurant (the second writer blocks until the first
   * commits, then its own subquery re-evaluates against the now-committed
   * state) - no new advisory-lock namespace, no lost updates. Deliberately
   * narrow (never the generic `save()` full-row upsert above), so a
   * concurrent, unrelated Restaurant profile edit can never be clobbered by
   * a stale in-memory entity.
   *
   * This raw SQL necessarily bypasses `withTenantScoping`'s Prisma Client
   * Extension (extensions only intercept the Prisma Client's own query
   * methods, never `$executeRaw`) even though `Restaurant` is a
   * `DIRECT_TENANT_OWNED_MODEL` - safe here specifically because every
   * caller has already resolved and authorized this exact `restaurantId` via
   * a tenant-scoped `findById` earlier in the same use case; this statement
   * only ever writes the one already-authorized row by primary key, never a
   * caller-influenced filter that could widen to another tenant's data.
   */
  async existsPubliclyById(id: RestaurantId): Promise<boolean> {
    const rows = await this.prismaContext.client.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS(
        SELECT 1 FROM restaurants WHERE id = ${id.value}::uuid AND deleted_at IS NULL
      ) AS "exists"
    `;
    return rows[0]?.exists ?? false;
  }

  async recomputeAverageRating(restaurantId: RestaurantId, at: Date): Promise<void> {
    await this.prismaContext.client.$executeRaw`
      UPDATE restaurants
      SET average_rating = (
        SELECT AVG(rating)::numeric(3,2)
        FROM reviews
        WHERE restaurant_id = ${restaurantId.value}::uuid AND deleted_at IS NULL
      ),
      updated_at = ${at}
      WHERE id = ${restaurantId.value}::uuid
    `;
  }

  async lockForRatingRecompute(restaurantId: RestaurantId): Promise<void> {
    await this.prismaContext.client.$queryRaw`
      SELECT id FROM restaurants WHERE id = ${restaurantId.value}::uuid FOR UPDATE
    `;
  }
}
