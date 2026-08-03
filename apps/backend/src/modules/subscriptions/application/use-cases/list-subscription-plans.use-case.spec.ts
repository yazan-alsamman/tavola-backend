import { ListSubscriptionPlansUseCase } from './list-subscription-plans.use-case';
import { SubscriptionPlan } from '../../domain/entities/subscription-plan.entity';
import { InMemorySubscriptionPlanRepository } from '../../../../../test/subscriptions/support/in-memory-subscription-plan.repository';

describe('ListSubscriptionPlansUseCase', () => {
  const now = new Date('2026-07-28T12:00:00.000Z');

  function build() {
    const subscriptionPlanRepository = new InMemorySubscriptionPlanRepository();
    const useCase = new ListSubscriptionPlansUseCase(subscriptionPlanRepository);
    return { useCase, subscriptionPlanRepository };
  }

  function plan(overrides: { id: string; slug: string }): SubscriptionPlan {
    return SubscriptionPlan.create({
      id: overrides.id,
      name: `Plan ${overrides.slug}`,
      slug: overrides.slug,
      maxRestaurants: 10,
      maxBranchesPerRestaurant: 5,
      maxEmployeesPerRestaurant: 20,
      now,
    });
  }

  it('returns every plan mapped to SubscriptionPlanResult, including archivedAt', async () => {
    const { useCase, subscriptionPlanRepository } = build();
    await subscriptionPlanRepository.save(
      plan({ id: '11111111-1111-4111-8111-111111111111', slug: 'starter' }),
    );
    const archived = plan({ id: '22222222-2222-4222-8222-222222222222', slug: 'legacy' }).archive(
      now,
    );
    await subscriptionPlanRepository.save(archived);

    const result = await useCase.execute();

    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          planId: '11111111-1111-4111-8111-111111111111',
          slug: 'starter',
          maxRestaurants: 10,
          maxBranchesPerRestaurant: 5,
          maxEmployeesPerRestaurant: 20,
          archivedAt: null,
        }),
        expect.objectContaining({
          planId: '22222222-2222-4222-8222-222222222222',
          slug: 'legacy',
          archivedAt: now,
        }),
      ]),
    );
  });

  it('returns an empty array when no plans are seeded', async () => {
    const { useCase } = build();

    const result = await useCase.execute();

    expect(result).toEqual([]);
  });
});
