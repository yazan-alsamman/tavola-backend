import { Restaurant as PrismaRestaurant } from '@prisma/client';
import { Restaurant as RestaurantEntity } from '../../domain/entities/restaurant.entity';
import { RestaurantStatus } from '../../domain/enums/restaurant.enums';

export class RestaurantPrismaMapper {
  static toDomain(row: PrismaRestaurant): RestaurantEntity {
    return RestaurantEntity.reconstitute({
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      slug: row.slug,
      logoId: row.logoId,
      coverImageId: row.coverImageId,
      description: row.description,
      cuisineType: row.cuisineType,
      averageRating: row.averageRating === null ? null : row.averageRating.toNumber(),
      priceLevel: row.priceLevel,
      status: row.status as RestaurantStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    });
  }

  /**
   * `averageRating` is returned as a plain `number | null` here (not
   * `Prisma.Decimal`) - Prisma's write-side input types for a `Decimal`
   * column accept `number | string | Decimal`, so callers pass this straight
   * through to `create`/`update` `data` without constructing a `Decimal`.
   * Never populated by this module's own CRUD (computed by the future
   * Reviews module) - always `null` for every row this mapper produces.
   */
  static toPersistence(
    restaurant: RestaurantEntity,
  ): Omit<PrismaRestaurant, 'averageRating'> & { averageRating: number | null } {
    const props = restaurant.toProps();
    return {
      id: props.id,
      organizationId: props.organizationId,
      name: props.name,
      slug: props.slug,
      logoId: props.logoId,
      coverImageId: props.coverImageId,
      description: props.description,
      cuisineType: props.cuisineType,
      averageRating: props.averageRating,
      priceLevel: props.priceLevel,
      status: props.status,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
      deletedAt: props.deletedAt,
    };
  }
}
