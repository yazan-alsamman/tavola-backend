import { Injectable, Inject } from '@nestjs/common';
import {
  TenantContextPort,
  TENANT_CONTEXT_PORT,
} from '@shared/application/ports/tenant-context.port';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import {
  RestaurantUsageRepository,
  RESTAURANT_USAGE_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant-usage.repository';
import {
  SubscriptionRepository,
  SUBSCRIPTION_REPOSITORY,
} from '../../domain/repositories/subscription.repository';
import {
  SubscriptionPlanRepository,
  SUBSCRIPTION_PLAN_REPOSITORY,
} from '../../domain/repositories/subscription-plan.repository';
import {
  SubscriptionUsageRepository,
  SUBSCRIPTION_USAGE_REPOSITORY,
} from '../../domain/repositories/subscription-usage.repository';
import { SubscriptionNotFoundException } from '../../domain/exceptions/subscription-not-found.exception';
import { SubscriptionPlanNotFoundException } from '../../domain/exceptions/subscription-plan-not-found.exception';
import { SubscriptionUsageResult } from '../dto/subscription-usage.result';

const MAX_RESTAURANTS_PER_USAGE_READ = 5000;

/** Read-only. Same dual-caller shape as `GetOrganizationSubscriptionUseCase` - see that class's doc comment. */
@Injectable()
export class GetOrganizationSubscriptionUsageUseCase {
  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY)
    private readonly subscriptionRepository: SubscriptionRepository,
    @Inject(SUBSCRIPTION_PLAN_REPOSITORY)
    private readonly subscriptionPlanRepository: SubscriptionPlanRepository,
    @Inject(SUBSCRIPTION_USAGE_REPOSITORY)
    private readonly subscriptionUsageRepository: SubscriptionUsageRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(RESTAURANT_USAGE_REPOSITORY)
    private readonly restaurantUsageRepository: RestaurantUsageRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  async execute(organizationId: string): Promise<SubscriptionUsageResult> {
    return this.tenantContext.runAsync(
      { organizationId, userId: null, correlationId: organizationId },
      () => this.build(organizationId),
    );
  }

  private async build(organizationId: string): Promise<SubscriptionUsageResult> {
    const subscription = await this.subscriptionRepository.findByOrganizationId();
    if (subscription === null) {
      throw new SubscriptionNotFoundException();
    }
    const plan = await this.subscriptionPlanRepository.findById(subscription.subscriptionPlanId);
    if (plan === null) {
      throw new SubscriptionPlanNotFoundException();
    }
    const orgUsage = await this.subscriptionUsageRepository.findByOrganizationId();

    const restaurants = await this.restaurantRepository.findMany(1, MAX_RESTAURANTS_PER_USAGE_READ);
    const restaurantIds = restaurants.items.map((r) => r.restaurantId);
    const restaurantUsages =
      await this.restaurantUsageRepository.findManyByRestaurantIds(restaurantIds);
    const usageByRestaurantId = new Map(
      restaurantUsages.map((usage) => [usage.restaurantId.value, usage]),
    );

    return {
      organizationId,
      restaurantCount: orgUsage?.restaurantCount ?? 0,
      maxRestaurants: plan.maxRestaurants,
      restaurants: restaurants.items.map((restaurant) => {
        const usage = usageByRestaurantId.get(restaurant.restaurantId.value);
        return {
          restaurantId: restaurant.restaurantId.value,
          branchCount: usage?.branchCount ?? 0,
          maxBranchesPerRestaurant: plan.maxBranchesPerRestaurant,
          employeeCount: usage?.employeeCount ?? 0,
          maxEmployeesPerRestaurant: plan.maxEmployeesPerRestaurant,
        };
      }),
    };
  }
}
