import { GetOrganizationSubscriptionUsageUseCase } from './get-organization-subscription-usage.use-case';
import { Subscription } from '../../domain/entities/subscription.entity';
import { SubscriptionPlan } from '../../domain/entities/subscription-plan.entity';
import { SubscriptionUsage } from '../../domain/entities/subscription-usage.entity';
import { SubscriptionNotFoundException } from '../../domain/exceptions/subscription-not-found.exception';
import { SubscriptionPlanNotFoundException } from '../../domain/exceptions/subscription-plan-not-found.exception';
import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import { RestaurantStatus } from '@modules/restaurants/domain/enums/restaurant.enums';
import { RestaurantUsage } from '@modules/restaurants/domain/entities/restaurant-usage.entity';
import { InMemorySubscriptionRepository } from '../../../../../test/subscriptions/support/in-memory-subscription.repository';
import { InMemorySubscriptionPlanRepository } from '../../../../../test/subscriptions/support/in-memory-subscription-plan.repository';
import { InMemorySubscriptionUsageRepository } from '../../../../../test/subscriptions/support/in-memory-subscription-usage.repository';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryRestaurantUsageRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-usage.repository';
import { RecordingTenantContextPort } from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';

describe('GetOrganizationSubscriptionUsageUseCase', () => {
  const now = new Date('2026-07-28T12:00:00.000Z');
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const planId = '22222222-2222-4222-8222-222222222222';
  const subscriptionId = '33333333-3333-4333-8333-333333333333';
  const restaurantId = '44444444-4444-4444-8444-444444444444';

  function build() {
    const subscriptionRepository = new InMemorySubscriptionRepository(organizationId);
    const subscriptionPlanRepository = new InMemorySubscriptionPlanRepository();
    const subscriptionUsageRepository = new InMemorySubscriptionUsageRepository(organizationId);
    const restaurantRepository = new InMemoryRestaurantRepository();
    const restaurantUsageRepository = new InMemoryRestaurantUsageRepository();
    const tenantContext = new RecordingTenantContextPort();
    const useCase = new GetOrganizationSubscriptionUsageUseCase(
      subscriptionRepository,
      subscriptionPlanRepository,
      subscriptionUsageRepository,
      restaurantRepository,
      restaurantUsageRepository,
      tenantContext,
    );
    return {
      useCase,
      subscriptionRepository,
      subscriptionPlanRepository,
      subscriptionUsageRepository,
      restaurantRepository,
      restaurantUsageRepository,
      tenantContext,
    };
  }

  async function seedSubscriptionAndPlan(
    subscriptionRepository: InMemorySubscriptionRepository,
    subscriptionPlanRepository: InMemorySubscriptionPlanRepository,
  ): Promise<void> {
    await subscriptionRepository.create(
      Subscription.create({
        id: subscriptionId,
        organizationId,
        subscriptionPlanId: planId,
        startsAt: now,
        now,
      }),
    );
    await subscriptionPlanRepository.save(
      SubscriptionPlan.create({
        id: planId,
        name: 'Growth',
        slug: 'growth',
        maxRestaurants: 10,
        maxBranchesPerRestaurant: 5,
        maxEmployeesPerRestaurant: 20,
        now,
      }),
    );
  }

  it('aggregates org-level and per-restaurant usage against the plan limits', async () => {
    const {
      useCase,
      subscriptionRepository,
      subscriptionPlanRepository,
      subscriptionUsageRepository,
      restaurantRepository,
      restaurantUsageRepository,
    } = build();
    await seedSubscriptionAndPlan(subscriptionRepository, subscriptionPlanRepository);
    await subscriptionUsageRepository.create(
      SubscriptionUsage.create({ id: 'usage-1', organizationId, now }),
    );
    await subscriptionUsageRepository.incrementRestaurantCountIfUnderLimit(organizationId, 10);
    await restaurantRepository.save(
      Restaurant.create({
        id: restaurantId,
        organizationId,
        name: 'The Old Mill',
        slug: 'the-old-mill',
        logoId: null,
        coverImageId: null,
        description: null,
        cuisineType: null,
        averageRating: null,
        priceLevel: null,
        status: RestaurantStatus.Active,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }),
    );
    await restaurantUsageRepository.create(
      RestaurantUsage.create({ id: 'ru-1', restaurantId, now }),
    );
    await restaurantUsageRepository.incrementBranchCountIfUnderLimit(
      RestaurantId.create(restaurantId),
      5,
    );

    const result = await useCase.execute(organizationId);

    expect(result.organizationId).toBe(organizationId);
    expect(result.restaurantCount).toBe(1);
    expect(result.maxRestaurants).toBe(10);
    expect(result.restaurants).toEqual([
      {
        restaurantId,
        branchCount: 1,
        maxBranchesPerRestaurant: 5,
        employeeCount: 0,
        maxEmployeesPerRestaurant: 20,
      },
    ]);
  });

  it('defaults restaurantCount to 0 when no SubscriptionUsage row exists yet', async () => {
    const { useCase, subscriptionRepository, subscriptionPlanRepository } = build();
    await seedSubscriptionAndPlan(subscriptionRepository, subscriptionPlanRepository);

    const result = await useCase.execute(organizationId);

    expect(result.restaurantCount).toBe(0);
    expect(result.restaurants).toEqual([]);
  });

  it('defaults a restaurant with no usage row yet to zero counts', async () => {
    const { useCase, subscriptionRepository, subscriptionPlanRepository, restaurantRepository } =
      build();
    await seedSubscriptionAndPlan(subscriptionRepository, subscriptionPlanRepository);
    await restaurantRepository.save(
      Restaurant.create({
        id: restaurantId,
        organizationId,
        name: 'The Old Mill',
        slug: 'the-old-mill',
        logoId: null,
        coverImageId: null,
        description: null,
        cuisineType: null,
        averageRating: null,
        priceLevel: null,
        status: RestaurantStatus.Active,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }),
    );

    const result = await useCase.execute(organizationId);

    expect(result.restaurants).toEqual([
      {
        restaurantId,
        branchCount: 0,
        maxBranchesPerRestaurant: 5,
        employeeCount: 0,
        maxEmployeesPerRestaurant: 20,
      },
    ]);
  });

  it('throws SubscriptionNotFoundException when the organization has no subscription', async () => {
    const { useCase } = build();

    await expect(useCase.execute(organizationId)).rejects.toBeInstanceOf(
      SubscriptionNotFoundException,
    );
  });

  it('throws SubscriptionPlanNotFoundException when the referenced plan no longer exists', async () => {
    const { useCase, subscriptionRepository } = build();
    await subscriptionRepository.create(
      Subscription.create({
        id: subscriptionId,
        organizationId,
        subscriptionPlanId: planId,
        startsAt: now,
        now,
      }),
    );

    await expect(useCase.execute(organizationId)).rejects.toBeInstanceOf(
      SubscriptionPlanNotFoundException,
    );
  });
});
