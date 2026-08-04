import { PlatformAdminRestaurantResult } from '../../application/dto/platform-admin-restaurant-lifecycle.command';
import { PlatformAdminRestaurantResponseDto } from '../dto/platform-admin-restaurant.response.dto';

export function toPlatformAdminRestaurantResponse(
  result: PlatformAdminRestaurantResult,
): PlatformAdminRestaurantResponseDto {
  return {
    restaurantId: result.restaurantId,
    organizationId: result.organizationId,
    name: result.name,
    status: result.status,
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
    deletedAt: result.deletedAt ? result.deletedAt.toISOString() : null,
  };
}
