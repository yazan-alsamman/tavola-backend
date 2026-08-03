import { SubscriptionResult } from '../../application/dto/subscription.result';
import { SubscriptionPlanResult } from '../../application/dto/subscription-plan.result';
import { SubscriptionUsageResult } from '../../application/dto/subscription-usage.result';
import { SubscriptionResponseDto } from '../dto/subscription.response.dto';
import { SubscriptionPlanResponseDto } from '../dto/subscription-plan.response.dto';
import { SubscriptionUsageResponseDto } from '../dto/subscription-usage.response.dto';

export function toSubscriptionResponse(result: SubscriptionResult): SubscriptionResponseDto {
  return {
    subscriptionId: result.subscriptionId,
    organizationId: result.organizationId,
    planId: result.planId,
    status: result.status,
    startsAt: result.startsAt.toISOString(),
    endsAt: result.endsAt ? result.endsAt.toISOString() : null,
  };
}

export function toSubscriptionPlanResponse(
  result: SubscriptionPlanResult,
): SubscriptionPlanResponseDto {
  return {
    planId: result.planId,
    name: result.name,
    slug: result.slug,
    maxRestaurants: result.maxRestaurants,
    maxBranchesPerRestaurant: result.maxBranchesPerRestaurant,
    maxEmployeesPerRestaurant: result.maxEmployeesPerRestaurant,
    archivedAt: result.archivedAt ? result.archivedAt.toISOString() : null,
  };
}

export function toSubscriptionUsageResponse(
  result: SubscriptionUsageResult,
): SubscriptionUsageResponseDto {
  return {
    organizationId: result.organizationId,
    restaurantCount: result.restaurantCount,
    maxRestaurants: result.maxRestaurants,
    restaurants: result.restaurants,
  };
}
