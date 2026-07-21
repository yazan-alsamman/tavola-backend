import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { RestaurantCuisineCategory } from '../../domain/entities/restaurant-cuisine-category.entity';
import { RestaurantCuisineCategoryRepository } from '../../domain/repositories/restaurant-cuisine-category.repository';
import { RestaurantCuisineCategoryPrismaMapper } from './restaurant-cuisine-category.prisma-mapper';

/**
 * `RestaurantCuisineCategory` is NOT in `withTenantScoping`'s
 * `DIRECT_TENANT_OWNED_MODELS` (no direct `organizationId` column), so
 * queries here run through the tenant-scoped `PrismaContext` client as a
 * verified no-op passthrough - exactly like `PrismaWorkingHoursRepository`.
 * This repository provides NO tenant isolation by itself. Every consuming
 * use case MUST resolve the parent `Restaurant` via `RestaurantRepository`
 * (which IS directly tenant-scoped) first, and only call these methods after
 * that succeeds.
 */
@Injectable()
export class PrismaRestaurantCuisineCategoryRepository implements RestaurantCuisineCategoryRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findAllByRestaurantId(restaurantId: RestaurantId): Promise<RestaurantCuisineCategory[]> {
    const rows = await this.prismaContext.client.restaurantCuisineCategory.findMany({
      where: { restaurantId: restaurantId.value },
    });
    return rows.map((row) => RestaurantCuisineCategoryPrismaMapper.toDomain(row));
  }

  /**
   * Full-replace of the entire assignment set for one restaurant: deletes
   * every existing row for `restaurantId` and inserts `entries` in a single
   * transaction, so a caller never observes a partially-replaced set.
   */
  async replaceAllForRestaurant(
    restaurantId: RestaurantId,
    entries: RestaurantCuisineCategory[],
  ): Promise<void> {
    await this.prismaContext.runInTransaction(async () => {
      await this.prismaContext.client.restaurantCuisineCategory.deleteMany({
        where: { restaurantId: restaurantId.value },
      });
      if (entries.length > 0) {
        await this.prismaContext.client.restaurantCuisineCategory.createMany({
          data: entries.map((entry) => RestaurantCuisineCategoryPrismaMapper.toPersistence(entry)),
        });
      }
    });
  }
}
