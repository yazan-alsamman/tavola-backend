import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { RestaurantOccasionCategory } from '../../domain/entities/restaurant-occasion-category.entity';
import { RestaurantOccasionCategoryRepository } from '../../domain/repositories/restaurant-occasion-category.repository';
import { RestaurantOccasionCategoryPrismaMapper } from './restaurant-occasion-category.prisma-mapper';

/**
 * `RestaurantOccasionCategory` is NOT in `withTenantScoping`'s
 * `DIRECT_TENANT_OWNED_MODELS` (no direct `organizationId` column), so
 * queries here run through the tenant-scoped `PrismaContext` client as a
 * verified no-op passthrough - exactly like `PrismaWorkingHoursRepository`.
 * This repository provides NO tenant isolation by itself. Every consuming
 * use case MUST resolve the parent `Restaurant` via `RestaurantRepository`
 * (which IS directly tenant-scoped) first, and only call these methods after
 * that succeeds.
 */
@Injectable()
export class PrismaRestaurantOccasionCategoryRepository implements RestaurantOccasionCategoryRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findAllByRestaurantId(restaurantId: RestaurantId): Promise<RestaurantOccasionCategory[]> {
    const rows = await this.prismaContext.client.restaurantOccasionCategory.findMany({
      where: { restaurantId: restaurantId.value },
    });
    return rows.map((row) => RestaurantOccasionCategoryPrismaMapper.toDomain(row));
  }

  /**
   * Full-replace of the entire assignment set for one restaurant: deletes
   * every existing row for `restaurantId` and inserts `entries` in a single
   * transaction, so a caller never observes a partially-replaced set.
   */
  async replaceAllForRestaurant(
    restaurantId: RestaurantId,
    entries: RestaurantOccasionCategory[],
  ): Promise<void> {
    await this.prismaContext.runInTransaction(async () => {
      await this.prismaContext.client.restaurantOccasionCategory.deleteMany({
        where: { restaurantId: restaurantId.value },
      });
      if (entries.length > 0) {
        await this.prismaContext.client.restaurantOccasionCategory.createMany({
          data: entries.map((entry) => RestaurantOccasionCategoryPrismaMapper.toPersistence(entry)),
        });
      }
    });
  }
}
