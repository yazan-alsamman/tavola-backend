import { GetRestaurantCuisineCategoriesUseCase } from './get-restaurant-cuisine-categories.use-case';
import { CreateRestaurantUseCase } from './create-restaurant.use-case';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { CuisineCategory } from '../../domain/entities/cuisine-category.entity';
import { RestaurantCuisineCategory } from '../../domain/entities/restaurant-cuisine-category.entity';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  UuidGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryRestaurantSettingsRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-settings.repository';
import { InMemoryRestaurantCuisineCategoryRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-cuisine-category.repository';
import { InMemoryCuisineCategoryRepository } from '../../../../../test/restaurants/support/in-memory-cuisine-category.repository';

describe('GetRestaurantCuisineCategoriesUseCase', () => {
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
    const createUseCase = new CreateRestaurantUseCase(
      restaurantRepository,
      restaurantSettingsRepository,
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
    const restaurantCuisineCategoryRepository = new InMemoryRestaurantCuisineCategoryRepository();
    const cuisineCategoryRepository = new InMemoryCuisineCategoryRepository();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);
    const useCase = new GetRestaurantCuisineCategoriesUseCase(
      restaurantRepository,
      restaurantCuisineCategoryRepository,
      cuisineCategoryRepository,
    );

    const result = await useCase.execute({ actor: baseActor(), restaurantId });

    expect(result).toEqual({ restaurantId, categories: [] });
  });

  it('returns assigned categories sorted by sortOrder', async () => {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const restaurantSettingsRepository = new InMemoryRestaurantSettingsRepository();
    const restaurantCuisineCategoryRepository = new InMemoryRestaurantCuisineCategoryRepository();
    const cuisineCategoryRepository = new InMemoryCuisineCategoryRepository();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);

    cuisineCategoryRepository.seed(
      CuisineCategory.reconstitute({
        id: 'cat-japanese',
        slug: 'japanese',
        name: 'Japanese',
        isActive: true,
        sortOrder: 2,
        createdAt: fixedNow,
        updatedAt: fixedNow,
      }),
    );
    cuisineCategoryRepository.seed(
      CuisineCategory.reconstitute({
        id: 'cat-italian',
        slug: 'italian',
        name: 'Italian',
        isActive: true,
        sortOrder: 1,
        createdAt: fixedNow,
        updatedAt: fixedNow,
      }),
    );

    await restaurantCuisineCategoryRepository.replaceAllForRestaurant(
      RestaurantId.create(restaurantId),
      [
        RestaurantCuisineCategory.create({
          id: 'assign-1',
          restaurantId,
          cuisineCategoryId: 'cat-japanese',
          createdAt: fixedNow,
        }),
        RestaurantCuisineCategory.create({
          id: 'assign-2',
          restaurantId,
          cuisineCategoryId: 'cat-italian',
          createdAt: fixedNow,
        }),
      ],
    );

    const useCase = new GetRestaurantCuisineCategoriesUseCase(
      restaurantRepository,
      restaurantCuisineCategoryRepository,
      cuisineCategoryRepository,
    );

    const result = await useCase.execute({ actor: baseActor(), restaurantId });

    expect(result.categories.map((category) => category.slug)).toEqual(['italian', 'japanese']);
  });

  it('throws RestaurantNotFoundException when the restaurant does not exist', async () => {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const restaurantCuisineCategoryRepository = new InMemoryRestaurantCuisineCategoryRepository();
    const cuisineCategoryRepository = new InMemoryCuisineCategoryRepository();
    const useCase = new GetRestaurantCuisineCategoriesUseCase(
      restaurantRepository,
      restaurantCuisineCategoryRepository,
      cuisineCategoryRepository,
    );

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });
});
