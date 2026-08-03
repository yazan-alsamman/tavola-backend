import { Subscription } from '@modules/subscriptions/domain/entities/subscription.entity';
import { SubscriptionPlan } from '@modules/subscriptions/domain/entities/subscription-plan.entity';
import { SubscriptionUsage } from '@modules/subscriptions/domain/entities/subscription-usage.entity';
import { InMemorySubscriptionRepository } from './in-memory-subscription.repository';
import { InMemorySubscriptionPlanRepository } from './in-memory-subscription-plan.repository';
import { InMemorySubscriptionUsageRepository } from './in-memory-subscription-usage.repository';
import { InMemoryRestaurantUsageRepository } from '../../restaurants/support/in-memory-restaurant-usage.repository';

const PERMISSIVE_LIMIT = 1_000_000;

/**
 * Phase 12 (Subscriptions, ADR-027) test fixture - a permissive (never-limiting)
 * Active Subscription for one Organization, so unit tests of OTHER use cases
 * (Restaurant/Branch/Employee CRUD) that merely need `CreateRestaurantUseCase`/
 * `CreateBranchUseCase`/`InviteEmployeeUseCase` to succeed as a seeding step
 * are not incidentally exercising subscription-limit enforcement. Tests that
 * DO exercise enforcement (`CreateRestaurantUseCase.spec.ts` etc.) construct
 * their own narrow-limit fixtures directly instead of using this helper.
 */
export function createPermissiveSubscriptionFixture(
  organizationId: string,
  ids: { planId: string; subscriptionId: string; usageId: string },
  now: Date,
): {
  subscriptionRepository: InMemorySubscriptionRepository;
  subscriptionPlanRepository: InMemorySubscriptionPlanRepository;
  subscriptionUsageRepository: InMemorySubscriptionUsageRepository;
  restaurantUsageRepository: InMemoryRestaurantUsageRepository;
} {
  const plan = SubscriptionPlan.create({
    id: ids.planId,
    name: 'Permissive Test Plan',
    slug: `permissive-test-plan-${ids.planId}`,
    maxRestaurants: PERMISSIVE_LIMIT,
    maxBranchesPerRestaurant: PERMISSIVE_LIMIT,
    maxEmployeesPerRestaurant: PERMISSIVE_LIMIT,
    now,
  });
  const subscription = Subscription.create({
    id: ids.subscriptionId,
    organizationId,
    subscriptionPlanId: plan.planId.value,
    startsAt: now,
    now,
  });
  const usage = SubscriptionUsage.create({ id: ids.usageId, organizationId, now });

  const subscriptionPlanRepository = new InMemorySubscriptionPlanRepository();
  const subscriptionRepository = new InMemorySubscriptionRepository(organizationId);
  const subscriptionUsageRepository = new InMemorySubscriptionUsageRepository(organizationId);
  const restaurantUsageRepository = new InMemoryRestaurantUsageRepository();

  void subscriptionPlanRepository.save(plan);
  void subscriptionRepository.create(subscription);
  void subscriptionUsageRepository.create(usage);

  return {
    subscriptionRepository,
    subscriptionPlanRepository,
    subscriptionUsageRepository,
    restaurantUsageRepository,
  };
}
