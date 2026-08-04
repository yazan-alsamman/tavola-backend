import { Restaurant } from '../../domain/entities/restaurant.entity';
import { PlatformAdminRestaurantResult } from '../dto/platform-admin-restaurant-lifecycle.command';

export function toPlatformAdminRestaurantResult(
  restaurant: Restaurant,
): PlatformAdminRestaurantResult {
  return {
    restaurantId: restaurant.restaurantId.value,
    organizationId: restaurant.organizationId.value,
    name: restaurant.name,
    status: restaurant.status,
    createdAt: restaurant.createdAt,
    updatedAt: restaurant.updatedAt,
    deletedAt: restaurant.deletedAt,
  };
}
