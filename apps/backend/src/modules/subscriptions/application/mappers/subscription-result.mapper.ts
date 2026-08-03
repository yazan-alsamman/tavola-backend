import { Subscription } from '../../domain/entities/subscription.entity';
import { SubscriptionPlan } from '../../domain/entities/subscription-plan.entity';
import { SubscriptionResult } from '../dto/subscription.result';
import { SubscriptionPlanResult } from '../dto/subscription-plan.result';

export function toSubscriptionResult(subscription: Subscription): SubscriptionResult {
  return {
    subscriptionId: subscription.subscriptionId.value,
    organizationId: subscription.organizationId,
    planId: subscription.subscriptionPlanId.value,
    status: subscription.status,
    startsAt: subscription.startsAt,
    endsAt: subscription.endsAt,
  };
}

export function toSubscriptionPlanResult(plan: SubscriptionPlan): SubscriptionPlanResult {
  return {
    planId: plan.planId.value,
    name: plan.name,
    slug: plan.slug,
    maxRestaurants: plan.maxRestaurants,
    maxBranchesPerRestaurant: plan.maxBranchesPerRestaurant,
    maxEmployeesPerRestaurant: plan.maxEmployeesPerRestaurant,
    archivedAt: plan.archivedAt,
  };
}
