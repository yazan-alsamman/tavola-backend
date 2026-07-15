import { Favorite as PrismaFavorite } from '@prisma/client';
import { FavoriteRestaurant } from '../../domain/entities/favorite-restaurant.entity';

export class FavoriteRestaurantPrismaMapper {
  static toDomain(row: PrismaFavorite): FavoriteRestaurant {
    return FavoriteRestaurant.reconstitute({
      id: row.id,
      userId: row.userId,
      restaurantId: row.restaurantId,
      createdAt: row.createdAt,
    });
  }

  static toPersistence(favorite: FavoriteRestaurant): PrismaFavorite {
    const props = favorite.toProps();
    return {
      id: props.id,
      userId: props.userId,
      restaurantId: props.restaurantId,
      createdAt: props.createdAt,
    };
  }
}
