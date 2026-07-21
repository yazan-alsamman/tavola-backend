import { RestaurantCuisineCategory as PrismaRestaurantCuisineCategory } from '@prisma/client';
import { RestaurantCuisineCategory as RestaurantCuisineCategoryEntity } from '../../domain/entities/restaurant-cuisine-category.entity';

export class RestaurantCuisineCategoryPrismaMapper {
  static toDomain(row: PrismaRestaurantCuisineCategory): RestaurantCuisineCategoryEntity {
    return RestaurantCuisineCategoryEntity.reconstitute({
      id: row.id,
      restaurantId: row.restaurantId,
      cuisineCategoryId: row.cuisineCategoryId,
      createdAt: row.createdAt,
    });
  }

  static toPersistence(
    assignment: RestaurantCuisineCategoryEntity,
  ): PrismaRestaurantCuisineCategory {
    const props = assignment.toProps();
    return {
      id: props.id,
      restaurantId: props.restaurantId,
      cuisineCategoryId: props.cuisineCategoryId,
      createdAt: props.createdAt,
    };
  }
}
