import { RestaurantResult } from '@modules/restaurants/application/dto/restaurant.result';
import { BranchResult } from '@modules/branches/application/dto/branch.result';
import { FloorPlanResult } from '@modules/tables/application/dto/floor-plan.result';
import { RestaurantResponseDto } from '@modules/restaurants/presentation/dto/restaurant.response.dto';
import { BranchResponseDto } from '@modules/branches/presentation/dto/branch.response.dto';
import { FloorPlanResponseDto } from '@modules/tables/presentation/dto/floor-plan.response.dto';

/**
 * Field-for-field identical to `RestaurantsController`/`BranchesController`/
 * `FloorPlansController`'s own private `toResponse` mappers - duplicated
 * (not imported) because those are private class methods, not exported
 * functions, and Table already extracted a shared, importable
 * `toTableResponse` (`@modules/tables/.../table-response.mapper`) reused
 * directly by `DiscoveryController` instead of being duplicated here.
 */
export function toDiscoveryRestaurantResponse(result: RestaurantResult): RestaurantResponseDto {
  return {
    restaurantId: result.restaurantId,
    name: result.name,
    slug: result.slug,
    logoId: result.logoId,
    coverImageId: result.coverImageId,
    description: result.description,
    cuisineType: result.cuisineType,
    averageRating: result.averageRating,
    priceLevel: result.priceLevel,
    status: result.status,
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
  };
}

export function toDiscoveryBranchResponse(result: BranchResult): BranchResponseDto {
  return {
    branchId: result.branchId,
    restaurantId: result.restaurantId,
    city: result.city,
    district: result.district,
    address: result.address,
    latitude: result.latitude,
    longitude: result.longitude,
    countryCode: result.countryCode,
    currency: result.currency,
    timezone: result.timezone,
    phone: result.phone,
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
  };
}

export function toDiscoveryFloorPlanResponse(result: FloorPlanResult): FloorPlanResponseDto {
  return {
    floorPlanId: result.floorPlanId,
    branchId: result.branchId,
    name: result.name,
    isActive: result.isActive,
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
  };
}
