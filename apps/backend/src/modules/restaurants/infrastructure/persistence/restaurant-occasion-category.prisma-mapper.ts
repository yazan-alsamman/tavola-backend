import { RestaurantOccasionCategory as PrismaRestaurantOccasionCategory } from '@prisma/client';
import { RestaurantOccasionCategory as RestaurantOccasionCategoryEntity } from '../../domain/entities/restaurant-occasion-category.entity';

export class RestaurantOccasionCategoryPrismaMapper {
  static toDomain(row: PrismaRestaurantOccasionCategory): RestaurantOccasionCategoryEntity {
    return RestaurantOccasionCategoryEntity.reconstitute({
      id: row.id,
      restaurantId: row.restaurantId,
      occasionCategoryId: row.occasionCategoryId,
      createdAt: row.createdAt,
    });
  }

  static toPersistence(
    assignment: RestaurantOccasionCategoryEntity,
  ): PrismaRestaurantOccasionCategory {
    const props = assignment.toProps();
    return {
      id: props.id,
      restaurantId: props.restaurantId,
      occasionCategoryId: props.occasionCategoryId,
      createdAt: props.createdAt,
    };
  }
}
