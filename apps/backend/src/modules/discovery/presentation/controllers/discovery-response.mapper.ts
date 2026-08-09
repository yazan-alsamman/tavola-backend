import { RestaurantResult } from '@modules/restaurants/application/dto/restaurant.result';
import { WorkingHoursEntryResult } from '@modules/restaurants/application/dto/working-hours.result';
import { BranchResult } from '@modules/branches/application/dto/branch.result';
import { BranchWorkingHoursEntryResult } from '@modules/branches/application/dto/branch-working-hours.result';
import { FloorPlanResult } from '@modules/tables/application/dto/floor-plan.result';
import { TableResult } from '@modules/tables/application/dto/table.result';
import { RestaurantPublicResponseDto } from '../dto/restaurant-public.response.dto';
import { BranchPublicResponseDto } from '../dto/branch-public.response.dto';
import { WorkingHoursEntryPublicResponseDto } from '../dto/working-hours-entry-public.response.dto';
import { DiscoverableRestaurant } from '../../application/use-cases/list-discoverable-restaurants.use-case';
import { NearbyDiscoverableRestaurant } from '../../application/use-cases/nearby-restaurants.use-case';
import { FloorPlanPublicResponseDto } from '../dto/floor-plan-public.response.dto';
import { TablePublicResponseDto } from '../dto/table-public.response.dto';
import { DiscoverableRestaurantResponseDto } from '../dto/discoverable-restaurant.response.dto';
import { NearbyRestaurantResponseDto } from '../dto/nearby-restaurant.response.dto';

/**
 * Field-for-field identical to `RestaurantsController`/`BranchesController`'s
 * own private `toResponse` mappers - duplicated (not imported) because those
 * are private class methods, not exported functions.
 *
 * Phase 15.5 (Discovery Module, architecture frozen 2026-07-29, D11): the
 * FloorPlan/Table mapping no longer reuses the internal `toTableResponse`/
 * `FloorPlanResponseDto` shapes - see `toFloorPlanPublicResponse`/
 * `toTablePublicResponse` below and their target DTOs' own doc comments for
 * the customer-safe projection correction.
 *
 * Public Working Hours & Restaurant Phone Privacy (customer-facing
 * correction): `toDiscoveryRestaurantResponse`/`toDiscoveryBranchResponse`
 * now target the dedicated `RestaurantPublicResponseDto`/
 * `BranchPublicResponseDto` (not the shared private `RestaurantResponseDto`/
 * `BranchResponseDto`) - `toDiscoveryBranchResponse` structurally excludes
 * `phone` (never copied from `BranchResult` into the response object, not
 * merely omitted from a TypeScript type) and both now include `workingHours`.
 */
function toWorkingHoursEntryPublicResponse(
  entry: WorkingHoursEntryResult | BranchWorkingHoursEntryResult,
): WorkingHoursEntryPublicResponseDto {
  return {
    dayOfWeek: entry.dayOfWeek,
    openingTime: entry.openingTime,
    closingTime: entry.closingTime,
    breakStartTime: entry.breakStartTime,
    breakEndTime: entry.breakEndTime,
  };
}

export function toDiscoveryRestaurantResponse(
  result: RestaurantResult & { workingHours: WorkingHoursEntryResult[] },
): RestaurantPublicResponseDto {
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
    workingHours: result.workingHours.map(toWorkingHoursEntryPublicResponse),
  };
}

export function toDiscoveryBranchResponse(
  result: BranchResult & { workingHours: BranchWorkingHoursEntryResult[] },
): BranchPublicResponseDto {
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
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
    workingHours: result.workingHours.map(toWorkingHoursEntryPublicResponse),
  };
}

/** D9: adds `hasActiveOffer`/`hasMenu` to the plain restaurant response - used by search/nearby/comparison results, never the plain detail route. */
export function toDiscoverableRestaurantResponse(
  result: DiscoverableRestaurant,
): DiscoverableRestaurantResponseDto {
  return {
    ...toDiscoveryRestaurantResponse(result),
    hasActiveOffer: result.hasActiveOffer,
    hasMenu: result.hasMenu,
  };
}

export function toNearbyRestaurantResponse(
  result: NearbyDiscoverableRestaurant,
): NearbyRestaurantResponseDto {
  return {
    ...toDiscoverableRestaurantResponse(result),
    nearestBranchId: result.nearestBranchId,
    distanceKm: result.distanceKm,
  };
}

/** D11: the customer-safe FloorPlan projection - excludes isActive/timestamps (see FloorPlanPublicResponseDto's own doc comment). */
export function toFloorPlanPublicResponse(result: FloorPlanResult): FloorPlanPublicResponseDto {
  return {
    floorPlanId: result.floorPlanId,
    branchId: result.branchId,
    name: result.name,
  };
}

/** D11: the customer-safe Table projection - excludes mergeGroupId/isMergePrimary/status/branchId/timestamps (see TablePublicResponseDto's own doc comment). */
export function toTablePublicResponse(result: TableResult): TablePublicResponseDto {
  return {
    tableId: result.tableId,
    floorPlanId: result.floorPlanId,
    tableNumber: result.tableNumber,
    capacity: result.capacity,
    shape: result.shape,
    floor: result.floor,
    positionX: result.positionX,
    positionY: result.positionY,
    width: result.width,
    height: result.height,
    rotation: result.rotation,
    layer: result.layer,
    indoor: result.indoor,
    vip: result.vip,
    smoking: result.smoking,
  };
}
