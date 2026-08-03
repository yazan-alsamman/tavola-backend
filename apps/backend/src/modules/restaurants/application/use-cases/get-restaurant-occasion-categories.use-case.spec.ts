import { GetRestaurantOccasionCategoriesUseCase } from './get-restaurant-occasion-categories.use-case';
import { CreateRestaurantUseCase } from './create-restaurant.use-case';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { OccasionCategory } from '../../domain/entities/occasion-category.entity';
import { RestaurantOccasionCategory } from '../../domain/entities/restaurant-occasion-category.entity';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  UuidGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { createPermissiveSubscriptionFixture } from '../../../../../test/subscriptions/support/permissive-subscription-fixture';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryRestaurantSettingsRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-settings.repository';
import { InMemoryRestaurantOccasionCategoryRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-occasion-category.repository';
import { InMemoryOccasionCategoryRepository } from '../../../../../test/restaurants/support/in-memory-occasion-category.repository';

describe('GetRestaurantOccasionCategoriesUseCase', () => {
  const fixedNow = new Date('2026-07-16T12:00:00.000Z');

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

  async function seedRestaurant(
    restaurantRepository: InMemoryRestaurantRepository,
    restaurantSettingsRepository: InMemoryRestaurantSettingsRepository,
  ): Promise<string> {
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
      restaurantRepository,
      restaurantSettingsRepository,
      restaurantUsageRepository,
      subscriptionRepository,
      subscriptionPlanRepository,
      subscriptionUsageRepository,
      new FixedClock(fixedNow),
      new UuidGenerator(),
      new CollectingEventPublisher(),
      new ImmediateUnitOfWork(),
    );
    const result = await createUseCase.execute({
      actor: baseActor(),
      name: 'The Old Mill',
      description: null,
      cuisineType: null,
      priceLevel: null,
    });
    return result.restaurantId;
  }

  it('returns an empty categories array for a freshly created restaurant', async () => {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const restaurantSettingsRepository = new InMemoryRestaurantSettingsRepository();
    const restaurantOccasionCategoryRepository = new InMemoryRestaurantOccasionCategoryRepository();
    const occasionCategoryRepository = new InMemoryOccasionCategoryRepository();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);
    const useCase = new GetRestaurantOccasionCategoriesUseCase(
      restaurantRepository,
      restaurantOccasionCategoryRepository,
      occasionCategoryRepository,
    );

    const result = await useCase.execute({ actor: baseActor(), restaurantId });

    expect(result).toEqual({ restaurantId, categories: [] });
  });

  it('returns assigned categories sorted by sortOrder', async () => {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const restaurantSettingsRepository = new InMemoryRestaurantSettingsRepository();
    const restaurantOccasionCategoryRepository = new InMemoryRestaurantOccasionCategoryRepository();
    const occasionCategoryRepository = new InMemoryOccasionCategoryRepository();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);

    occasionCategoryRepository.seed(
      OccasionCategory.reconstitute({
        id: 'cat-family',
        slug: 'family',
        name: 'Family',
        isActive: true,
        sortOrder: 2,
        createdAt: fixedNow,
        updatedAt: fixedNow,
      }),
    );
    occasionCategoryRepository.seed(
      OccasionCategory.reconstitute({
        id: 'cat-date-night',
        slug: 'date-night',
        name: 'Date Night',
        isActive: true,
        sortOrder: 1,
        createdAt: fixedNow,
        updatedAt: fixedNow,
      }),
    );

    await restaurantOccasionCategoryRepository.replaceAllForRestaurant(
      RestaurantId.create(restaurantId),
      [
        RestaurantOccasionCategory.create({
          id: 'assign-1',
          restaurantId,
          occasionCategoryId: 'cat-family',
          createdAt: fixedNow,
        }),
        RestaurantOccasionCategory.create({
          id: 'assign-2',
          restaurantId,
          occasionCategoryId: 'cat-date-night',
          createdAt: fixedNow,
        }),
      ],
    );

    const useCase = new GetRestaurantOccasionCategoriesUseCase(
      restaurantRepository,
      restaurantOccasionCategoryRepository,
      occasionCategoryRepository,
    );

    const result = await useCase.execute({ actor: baseActor(), restaurantId });

    expect(result.categories.map((category) => category.slug)).toEqual(['date-night', 'family']);
  });

  it('throws RestaurantNotFoundException when the restaurant does not exist', async () => {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const restaurantOccasionCategoryRepository = new InMemoryRestaurantOccasionCategoryRepository();
    const occasionCategoryRepository = new InMemoryOccasionCategoryRepository();
    const useCase = new GetRestaurantOccasionCategoriesUseCase(
      restaurantRepository,
      restaurantOccasionCategoryRepository,
      occasionCategoryRepository,
    );

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });
});
