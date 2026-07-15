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
}
