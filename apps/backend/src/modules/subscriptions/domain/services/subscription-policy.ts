import { Subscription } from '../entities/subscription.entity';
import { SubscriptionPlan } from '../entities/subscription-plan.entity';
import { SubscriptionUsage } from '../entities/subscription-usage.entity';
import { RestaurantUsage } from '@modules/restaurants/domain/entities/restaurant-usage.entity';
import { SubscriptionInactiveException } from '../exceptions/subscription-inactive.exception';
import { OrganizationLimitExceededException } from '../exceptions/organization-limit-exceeded.exception';
import { PlanDowngradeRejectedException } from '../exceptions/plan-downgrade-rejected.exception';

/**
 * `SubscriptionValidator`/`SubscriptionPolicy` (DOMAIN_MODEL.md,
 * AUTHORIZATION_ARCHITECTURE.md §22, ADR-027). Pure domain service - no I/O,
 * receives already-fetched entities from the calling use case and returns a
 * decision (throws on violation). Enforces plan limits BEFORE resource
 * creation, per the frozen evaluation order: RBAC -> Subscription entitlement
 * -> business-invariant policy (ADR-027 §8, AUTHORIZATION_ARCHITECTURE.md §16).
 *
 * Does NOT perform the actual atomic counter increment - that is
 * `SubscriptionUsageRepository`/`RestaurantUsageRepository`'s job (D15's
 * concurrency-safe conditional `UPDATE`), invoked directly by the use case in
 * the same transaction. This class only answers "is the subscription active"
 * and "would this exceed a limit given current usage" for cases where an
 * eager, informative check is useful (e.g. downgrade validation, which scans
 * every Restaurant up front rather than relying on a single conditional
 * increment).
 */
export class SubscriptionPolicy {
  /** Throws if the Subscription does not permit new resource creation (ADR-027 §9). */
  static assertPermitsResourceCreation(subscription: Subscription): void {
    if (!subscription.permitsResourceCreation()) {
      throw new SubscriptionInactiveException();
    }
  }

  /** Eager (non-atomic) check - the authoritative enforcement is the repository's conditional increment; this is used only for early, clear error messages before attempting it. */
  static assertUnderRestaurantLimit(usage: SubscriptionUsage, plan: SubscriptionPlan): void {
    if (usage.restaurantCount >= plan.maxRestaurants) {
      throw new OrganizationLimitExceededException('maxRestaurants');
    }
  }

  static assertUnderBranchLimit(usage: RestaurantUsage, plan: SubscriptionPlan): void {
    if (usage.branchCount >= plan.maxBranchesPerRestaurant) {
      throw new OrganizationLimitExceededException('maxBranchesPerRestaurant');
    }
  }

  static assertUnderEmployeeLimit(usage: RestaurantUsage, plan: SubscriptionPlan): void {
    if (usage.employeeCount >= plan.maxEmployeesPerRestaurant) {
      throw new OrganizationLimitExceededException('maxEmployeesPerRestaurant');
    }
  }

  /**
   * ADR-027 §7/D13 - downgrade is rejected outright if current usage exceeds
   * the target plan's limits. `maxRestaurants` is checked against the
   * Organization-wide `SubscriptionUsage`; `maxBranchesPerRestaurant`/
   * `maxEmployeesPerRestaurant` are checked against EVERY Restaurant's own
   * `RestaurantUsage` row (the maximum across all of them) - never an
   * Organization-wide sum, per the frozen per-Restaurant enforcement grain.
   */
  static validatePlanChange(
    targetPlan: SubscriptionPlan,
    organizationUsage: SubscriptionUsage,
    restaurantUsages: RestaurantUsage[],
  ): void {
    const violated: string[] = [];

    if (organizationUsage.restaurantCount > targetPlan.maxRestaurants) {
      violated.push('maxRestaurants');
    }

    const overBranchLimit = restaurantUsages.some(
      (usage) => usage.branchCount > targetPlan.maxBranchesPerRestaurant,
    );
    if (overBranchLimit) {
      violated.push('maxBranchesPerRestaurant');
    }

    const overEmployeeLimit = restaurantUsages.some(
      (usage) => usage.employeeCount > targetPlan.maxEmployeesPerRestaurant,
    );
    if (overEmployeeLimit) {
      violated.push('maxEmployeesPerRestaurant');
    }

    if (violated.length > 0) {
      throw new PlanDowngradeRejectedException(violated);
    }
  }
}
