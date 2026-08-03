import { SetRestaurantCuisineCategoriesUseCase } from './set-restaurant-cuisine-categories.use-case';
import { CreateRestaurantUseCase } from './create-restaurant.use-case';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { UnknownCuisineCategoryException } from '../../domain/exceptions/unknown-cuisine-category.exception';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { CuisineCategory } from '../../domain/entities/cuisine-category.entity';
import {
  CollectingAuditLogWriter,
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  UuidGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { createPermissiveSubscriptionFixture } from '../../../../../test/subscriptions/support/permissive-subscription-fixture';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryRestaurantSettingsRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-settings.repository';
import { InMemoryRestaurantCuisineCategoryRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-cuisine-category.repository';
import { InMemoryCuisineCategoryRepository } from '../../../../../test/restaurants/support/in-memory-cuisine-category.repository';

describe('SetRestaurantCuisineCategoriesUseCase', () => {
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

  function seedCatalog(cuisineCategoryRepository: InMemoryCuisineCategoryRepository) {
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
        id: 'cat-retired',
        slug: 'retired',
        name: 'Retired',
        isActive: false,
        sortOrder: 3,
        createdAt: fixedNow,
        updatedAt: fixedNow,
      }),
    );
  }

  function createUseCase(overrides?: { auditLogWriter?: CollectingAuditLogWriter }) {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const restaurantSettingsRepository = new InMemoryRestaurantSettingsRepository();
    const restaurantCuisineCategoryRepository = new InMemoryRestaurantCuisineCategoryRepository();
    const cuisineCategoryRepository = new InMemoryCuisineCategoryRepository();
    seedCatalog(cuisineCategoryRepository);
    const auditLogWriter = overrides?.auditLogWriter ?? new CollectingAuditLogWriter();
    const useCase = new SetRestaurantCuisineCategoriesUseCase(
      restaurantRepository,
      restaurantCuisineCategoryRepository,
      cuisineCategoryRepository,
      new FixedClock(fixedNow),
      new UuidGenerator(),
      auditLogWriter,
    );
    return {
      useCase,
      restaurantRepository,
      restaurantSettingsRepository,
      restaurantCuisineCategoryRepository,
      auditLogWriter,
    };
  }

  it('persists the submitted set and returns it sorted by sortOrder', async () => {
    const { useCase, restaurantRepository, restaurantSettingsRepository } = createUseCase();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      cuisineCategoryIds: ['cat-japanese', 'cat-italian'],
    });

    expect(result.restaurantId).toBe(restaurantId);
    expect(result.categories.map((category) => category.slug)).toEqual(['italian', 'japanese']);
  });

  it('deduplicates repeated ids in the request', async () => {
    const { useCase, restaurantRepository, restaurantSettingsRepository } = createUseCase();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      cuisineCategoryIds: ['cat-italian', 'cat-italian'],
    });

    expect(result.categories).toHaveLength(1);
  });

  it('an id omitted from cuisineCategoryIds is unassigned on the next replace', async () => {
    const { useCase, restaurantRepository, restaurantSettingsRepository } = createUseCase();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);
    await useCase.execute({
      actor: baseActor(),
      restaurantId,
      cuisineCategoryIds: ['cat-italian', 'cat-japanese'],
    });

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      cuisineCategoryIds: ['cat-italian'],
    });

    expect(result.categories.map((category) => category.slug)).toEqual(['italian']);
  });

  it('accepts an empty cuisineCategoryIds array (clears the assignment)', async () => {
    const { useCase, restaurantRepository, restaurantSettingsRepository } = createUseCase();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);
    await useCase.execute({
      actor: baseActor(),
      restaurantId,
      cuisineCategoryIds: ['cat-italian'],
    });

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      cuisineCategoryIds: [],
    });

    expect(result.categories).toEqual([]);
  });

  it('rejects an unknown cuisineCategoryId without persisting any change', async () => {
    const {
      useCase,
      restaurantRepository,
      restaurantSettingsRepository,
      restaurantCuisineCategoryRepository,
    } = createUseCase();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId,
        cuisineCategoryIds: ['does-not-exist'],
      }),
    ).rejects.toBeInstanceOf(UnknownCuisineCategoryException);

    const persisted = await restaurantCuisineCategoryRepository.findAllByRestaurantId(
      RestaurantId.create(restaurantId),
    );
    expect(persisted).toHaveLength(0);
  });

  it('rejects an inactive cuisineCategoryId', async () => {
    const { useCase, restaurantRepository, restaurantSettingsRepository } = createUseCase();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId,
        cuisineCategoryIds: ['cat-retired'],
      }),
    ).rejects.toBeInstanceOf(UnknownCuisineCategoryException);
  });

  it('writes exactly one audit log entry describing the update', async () => {
    const auditLogWriter = new CollectingAuditLogWriter();
    const { useCase, restaurantRepository, restaurantSettingsRepository } = createUseCase({
      auditLogWriter,
    });
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);

    await useCase.execute({
      actor: baseActor(),
      restaurantId,
      cuisineCategoryIds: ['cat-italian'],
      correlationId: 'corr-1',
    });

    expect(auditLogWriter.entries).toHaveLength(1);
    expect(auditLogWriter.entries[0]).toMatchObject({
      actorId: 'user-1',
      actorType: 'User',
      action: 'restaurant.cuisine_categories.updated',
      targetType: 'Restaurant',
      targetId: restaurantId,
      organizationId: baseActor().organizationId,
      correlationId: 'corr-1',
    });
  });

  it('throws RestaurantNotFoundException when the restaurant does not exist', async () => {
    const { useCase } = createUseCase();

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        cuisineCategoryIds: ['cat-italian'],
      }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });
});
