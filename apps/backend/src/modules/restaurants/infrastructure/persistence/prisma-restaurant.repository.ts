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
import {
  RATING_MIN_REVIEWS,
  ratingWindowStart,
} from '../../domain/policies/restaurant-rating.policy';

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

  async findByIdIncludingDeleted(id: RestaurantId): Promise<Restaurant | null> {
    const row = await this.prismaContext.client.restaurant.findUnique({
      where: { id: id.value },
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
        nameAr: data.nameAr,
        nameEn: data.nameEn,
        descriptionAr: data.descriptionAr,
        descriptionEn: data.descriptionEn,
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
    const windowStart = ratingWindowStart(at);
    await this.prismaContext.client.$executeRaw`
      UPDATE restaurants r
      SET rating_count = w.cnt,
          average_rating = CASE WHEN w.cnt >= ${RATING_MIN_REVIEWS} THEN w.avg_score ELSE NULL END,
          updated_at = ${at}
      FROM (
        SELECT COUNT(*)::int AS cnt, ROUND(AVG(score), 2)::numeric(3,2) AS avg_score
        FROM reviews
        WHERE restaurant_id = ${restaurantId.value}::uuid
          AND deleted_at IS NULL
          AND created_at >= ${windowStart}
      ) w
      WHERE r.id = ${restaurantId.value}::uuid
    `;
  }

  async recomputeAllRatings(at: Date): Promise<number> {
    const windowStart = ratingWindowStart(at);
    return this.prismaContext.client.$executeRaw`
      WITH windowed AS (
        SELECT restaurant_id, COUNT(*)::int AS cnt, ROUND(AVG(score), 2)::numeric(3,2) AS avg_score
        FROM reviews
        WHERE deleted_at IS NULL AND created_at >= ${windowStart}
        GROUP BY restaurant_id
      ),
      next AS (
        SELECT r.id,
               COALESCE(w.cnt, 0) AS cnt,
               CASE WHEN COALESCE(w.cnt, 0) >= ${RATING_MIN_REVIEWS} THEN w.avg_score ELSE NULL END AS avg
        FROM restaurants r
        LEFT JOIN windowed w ON w.restaurant_id = r.id
        WHERE r.deleted_at IS NULL
      )
      UPDATE restaurants r
      SET rating_count = next.cnt, average_rating = next.avg, updated_at = ${at}
      FROM next
      WHERE r.id = next.id
        AND (r.rating_count IS DISTINCT FROM next.cnt OR r.average_rating IS DISTINCT FROM next.avg)
    `;
  }

  async lockForRatingRecompute(restaurantId: RestaurantId): Promise<void> {
    await this.prismaContext.client.$queryRaw`
      SELECT id FROM restaurants WHERE id = ${restaurantId.value}::uuid FOR UPDATE
    `;
  }
}
