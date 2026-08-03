import { AssignSubscriptionUseCase } from './assign-subscription.use-case';
import { SubscriptionPlan } from '../../domain/entities/subscription-plan.entity';
import { SubscriptionStatus } from '../../domain/enums/subscription.enums';
import { SubscriptionPlanNotFoundException } from '../../domain/exceptions/subscription-plan-not-found.exception';
import { ArchivedPlanNotAssignableException } from '../../domain/exceptions/archived-plan-not-assignable.exception';
import { InvalidSubscriptionStatusTransitionException } from '../../domain/exceptions/invalid-subscription-status-transition.exception';
import { PlanDowngradeRejectedException } from '../../domain/exceptions/plan-downgrade-rejected.exception';
import {
  SubscriptionAssignedEvent,
  SubscriptionPlanChangedEvent,
} from '../../domain/events/subscription.events';
import { InMemorySubscriptionRepository } from '../../../../../test/subscriptions/support/in-memory-subscription.repository';
import { InMemorySubscriptionPlanRepository } from '../../../../../test/subscriptions/support/in-memory-subscription-plan.repository';
import { InMemorySubscriptionUsageRepository } from '../../../../../test/subscriptions/support/in-memory-subscription-usage.repository';
import { InMemoryRestaurantUsageRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-usage.repository';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  RecordingTenantContextPort,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('AssignSubscriptionUseCase', () => {
  const fixedNow = new Date('2026-07-28T12:00:00.000Z');
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const platformAdminUserId = 'platform-admin-1';

  function actor() {
    return { userId: platformAdminUserId };
  }

  function build() {
    const subscriptionRepository = new InMemorySubscriptionRepository(organizationId);
    const subscriptionPlanRepository = new InMemorySubscriptionPlanRepository();
    const subscriptionUsageRepository = new InMemorySubscriptionUsageRepository(organizationId);
    const restaurantUsageRepository = new InMemoryRestaurantUsageRepository();
    const restaurantRepository = new InMemoryRestaurantRepository();
    const expirationScheduler = {
      scheduled: [] as Array<{ subscriptionId: string; expireAt: Date }>,
      cancelled: [] as string[],
      async scheduleExpiration(subscriptionId: string, _organizationId: string, expireAt: Date) {
        this.scheduled.push({ subscriptionId, expireAt });
      },
      async cancelExpiration(subscriptionId: string) {
        this.cancelled.push(subscriptionId);
      },
    };
    const eventPublisher = new CollectingEventPublisher();
    const idGenerator = new SequentialIdGenerator([
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
      '66666666-6666-4666-8666-666666666666',
    ]);
    const useCase = new AssignSubscriptionUseCase(
      subscriptionRepository,
      subscriptionPlanRepository,
      subscriptionUsageRepository,
      restaurantUsageRepository,
      restaurantRepository,
      expirationScheduler,
      new FixedClock(fixedNow),
      idGenerator,
      eventPublisher,
      new ImmediateUnitOfWork(),
      new RecordingTenantContextPort(),
    );
    return {
      useCase,
      subscriptionRepository,
      subscriptionPlanRepository,
      subscriptionUsageRepository,
      expirationScheduler,
      eventPublisher,
    };
  }

  async function seedPlan(
    repository: InMemorySubscriptionPlanRepository,
    overrides: Partial<{
      id: string;
      slug: string;
      maxRestaurants: number;
      maxBranchesPerRestaurant: number;
      maxEmployeesPerRestaurant: number;
    }> = {},
  ): Promise<SubscriptionPlan> {
    const plan = SubscriptionPlan.create({
      id: overrides.id ?? '77777777-7777-4777-8777-777777777777',
      name: 'Test Plan',
      slug: overrides.slug ?? 'test-plan',
      maxRestaurants: overrides.maxRestaurants ?? 10,
      maxBranchesPerRestaurant: overrides.maxBranchesPerRestaurant ?? 5,
      maxEmployeesPerRestaurant: overrides.maxEmployeesPerRestaurant ?? 20,
      now: fixedNow,
    });
    await repository.save(plan);
    return plan;
  }

  it('throws SubscriptionPlanNotFoundException for an unknown plan', async () => {
    const { useCase } = build();
    await expect(
      useCase.execute({
        actor: actor(),
        organizationId,
        planId: '99999999-9999-4999-8999-999999999999',
      }),
    ).rejects.toBeInstanceOf(SubscriptionPlanNotFoundException);
  });

  it('throws ArchivedPlanNotAssignableException for an archived plan', async () => {
    const { useCase, subscriptionPlanRepository } = build();
    const plan = await seedPlan(subscriptionPlanRepository);
    await subscriptionPlanRepository.save(plan.archive(fixedNow));

    await expect(
      useCase.execute({ actor: actor(), organizationId, planId: plan.planId.value }),
    ).rejects.toBeInstanceOf(ArchivedPlanNotAssignableException);
  });

  it('creates a fresh Active Subscription + SubscriptionUsage when none exists, publishes SubscriptionAssigned', async () => {
    const { useCase, subscriptionPlanRepository, subscriptionUsageRepository, eventPublisher } =
      build();
    const plan = await seedPlan(subscriptionPlanRepository);

    const result = await useCase.execute({
      actor: actor(),
      organizationId,
      planId: plan.planId.value,
    });

    expect(result.status).toBe(SubscriptionStatus.Active);
    expect(result.planId).toBe(plan.planId.value);
    expect(result.endsAt).toBeNull();

    const usage = await subscriptionUsageRepository.findByOrganizationId();
    expect(usage).not.toBeNull();
    expect(usage?.restaurantCount).toBe(0);

    expect(eventPublisher.events).toHaveLength(1);
    const event = eventPublisher.events[0] as SubscriptionAssignedEvent;
    expect(event).toBeInstanceOf(SubscriptionAssignedEvent);
    expect(event.payload).toMatchObject({
      organizationId,
      planId: plan.planId.value,
      actorId: platformAdminUserId,
    });
  });

  it('schedules BullMQ expiration when endsAt is provided', async () => {
    const { useCase, subscriptionPlanRepository, expirationScheduler } = build();
    const plan = await seedPlan(subscriptionPlanRepository);
    const endsAt = new Date('2026-08-28T12:00:00.000Z');

    await useCase.execute({ actor: actor(), organizationId, planId: plan.planId.value, endsAt });

    expect(expirationScheduler.scheduled).toHaveLength(1);
    expect(expirationScheduler.scheduled[0].expireAt).toEqual(endsAt);
  });

  it('changePlan: Active -> Active with new plan, publishes SubscriptionPlanChanged', async () => {
    const { useCase, subscriptionPlanRepository, eventPublisher } = build();
    const planA = await seedPlan(subscriptionPlanRepository, {
      id: '77777777-7777-4777-8777-777777777777',
      slug: 'plan-a',
    });
    await useCase.execute({ actor: actor(), organizationId, planId: planA.planId.value });
    eventPublisher.events.length = 0;

    const planB = await seedPlan(subscriptionPlanRepository, {
      id: '88888888-8888-4888-8888-888888888888',
      slug: 'plan-b',
      maxRestaurants: 20,
    });
    const result = await useCase.execute({
      actor: actor(),
      organizationId,
      planId: planB.planId.value,
    });

    expect(result.planId).toBe(planB.planId.value);
    expect(result.status).toBe(SubscriptionStatus.Active);
    expect(eventPublisher.events).toHaveLength(1);
    expect(eventPublisher.events[0]).toBeInstanceOf(SubscriptionPlanChangedEvent);
  });

  it('changePlan: rejects a downgrade that would exceed current usage (D13)', async () => {
    const { useCase, subscriptionPlanRepository, subscriptionUsageRepository } = build();
    const bigPlan = await seedPlan(subscriptionPlanRepository, {
      id: '77777777-7777-4777-8777-777777777777',
      slug: 'big-plan',
      maxRestaurants: 10,
    });
    await useCase.execute({ actor: actor(), organizationId, planId: bigPlan.planId.value });

    // Simulate 5 restaurants already created under the big plan.
    for (let i = 0; i < 5; i += 1) {
      await subscriptionUsageRepository.incrementRestaurantCountIfUnderLimit(organizationId, 10);
    }

    const smallPlan = await seedPlan(subscriptionPlanRepository, {
      id: '88888888-8888-4888-8888-888888888888',
      slug: 'small-plan',
      maxRestaurants: 2,
    });

    await expect(
      useCase.execute({ actor: actor(), organizationId, planId: smallPlan.planId.value }),
    ).rejects.toBeInstanceOf(PlanDowngradeRejectedException);
  });

  it('rejects assignment when the Subscription is Suspended - must Reactivate first', async () => {
    const { useCase, subscriptionRepository, subscriptionPlanRepository } = build();
    const plan = await seedPlan(subscriptionPlanRepository);
    await useCase.execute({ actor: actor(), organizationId, planId: plan.planId.value });
    const existing = await subscriptionRepository.findByOrganizationId();
    await subscriptionRepository.updateIfStatus(
      existing!.suspend(fixedNow),
      SubscriptionStatus.Active,
    );

    await expect(
      useCase.execute({ actor: actor(), organizationId, planId: plan.planId.value }),
    ).rejects.toBeInstanceOf(InvalidSubscriptionStatusTransitionException);
  });

  it('reassigns (resumes) a Cancelled subscription via Assign, publishing SubscriptionAssigned again', async () => {
    const { useCase, subscriptionRepository, subscriptionPlanRepository, eventPublisher } = build();
    const plan = await seedPlan(subscriptionPlanRepository);
    await useCase.execute({ actor: actor(), organizationId, planId: plan.planId.value });
    const existing = await subscriptionRepository.findByOrganizationId();
    await subscriptionRepository.updateIfStatus(
      existing!.cancel(fixedNow),
      SubscriptionStatus.Active,
    );
    eventPublisher.events.length = 0;

    const result = await useCase.execute({
      actor: actor(),
      organizationId,
      planId: plan.planId.value,
    });

    expect(result.status).toBe(SubscriptionStatus.Active);
    expect(eventPublisher.events[0]).toBeInstanceOf(SubscriptionAssignedEvent);
  });
});
