import { GetRestaurantUseCase } from './get-restaurant.use-case';
import { CreateRestaurantUseCase } from './create-restaurant.use-case';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { createPermissiveSubscriptionFixture } from '../../../../../test/subscriptions/support/permissive-subscription-fixture';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryRestaurantSettingsRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-settings.repository';

describe('GetRestaurantUseCase', () => {
  const fixedNow = new Date('2026-07-16T12:00:00.000Z');
  const restaurantId = '11111111-1111-4111-8111-111111111111';

  function baseActor() {
    return {
      actorType: AccessTokenActorType.OrganizationMember as const,
      userId: 'user-1',
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
      organizationId: '33333333-3333-4333-8333-333333333333',
      orgRole: 'Owner',
      permissionsVersion: 1,
    };
  }

  async function seedRestaurant(repository: InMemoryRestaurantRepository) {
    const {
      subscriptionRepository,
      subscriptionPlanRepository,
      subscriptionUsageRepository,
      restaurantUsageRepository,
    } = createPermissiveSubscriptionFixture(
      '33333333-3333-4333-8333-333333333333',
      {
        planId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        subscriptionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        usageId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      },
      fixedNow,
    );
    const createUseCase = new CreateRestaurantUseCase(
      repository,
      new InMemoryRestaurantSettingsRepository(),
      restaurantUsageRepository,
      subscriptionRepository,
      subscriptionPlanRepository,
      subscriptionUsageRepository,
      new FixedClock(fixedNow),
      new SequentialIdGenerator([
        restaurantId,
        '22222222-2222-4222-8222-222222222222',
        '88888888-8888-4888-8888-888888888888',
        '99999999-9999-4999-8999-999999999999',
      ]),
      new CollectingEventPublisher(),
      new ImmediateUnitOfWork(),
    );
    await createUseCase.execute({
      actor: baseActor(),
      name: 'The Old Mill',
      description: 'Cozy',
      cuisineType: 'Italian',
      priceLevel: 2,
    });
  }

  it('returns the restaurant by id', async () => {
    const repository = new InMemoryRestaurantRepository();
    await seedRestaurant(repository);
    const useCase = new GetRestaurantUseCase(repository);

    const result = await useCase.execute({ actor: baseActor(), restaurantId });

    expect(result.restaurantId).toBe(restaurantId);
    expect(result.name).toBe('The Old Mill');
  });

  it('throws RestaurantNotFoundException for an unknown id', async () => {
    const repository = new InMemoryRestaurantRepository();
    const useCase = new GetRestaurantUseCase(repository);

    await expect(
      useCase.execute({ actor: baseActor(), restaurantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });
});
