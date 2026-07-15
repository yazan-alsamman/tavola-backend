import { Restaurant } from '../../domain/entities/restaurant.entity';
import { RestaurantResult } from '../dto/restaurant.result';

export function toRestaurantResult(restaurant: Restaurant): RestaurantResult {
  return {
    restaurantId: restaurant.restaurantId.value,
    name: restaurant.name,
    slug: restaurant.slug.value,
    logoId: restaurant.logoId,
    coverImageId: restaurant.coverImageId,
    description: restaurant.description,
    cuisineType: restaurant.cuisineType,
    averageRating: restaurant.averageRating,
    priceLevel: restaurant.priceLevel,
    status: restaurant.status,
    createdAt: restaurant.createdAt,
    updatedAt: restaurant.updatedAt,
  };
}
