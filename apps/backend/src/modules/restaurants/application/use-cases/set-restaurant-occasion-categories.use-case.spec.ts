import { SetRestaurantOccasionCategoriesUseCase } from './set-restaurant-occasion-categories.use-case';
import { CreateRestaurantUseCase } from './create-restaurant.use-case';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { UnknownOccasionCategoryException } from '../../domain/exceptions/unknown-occasion-category.exception';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { OccasionCategory } from '../../domain/entities/occasion-category.entity';
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
import { InMemoryRestaurantOccasionCategoryRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-occasion-category.repository';
import { InMemoryOccasionCategoryRepository } from '../../../../../test/restaurants/support/in-memory-occasion-category.repository';

describe('SetRestaurantOccasionCategoriesUseCase', () => {
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

  function seedCatalog(occasionCategoryRepository: InMemoryOccasionCategoryRepository) {
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
    const restaurantOccasionCategoryRepository = new InMemoryRestaurantOccasionCategoryRepository();
    const occasionCategoryRepository = new InMemoryOccasionCategoryRepository();
    seedCatalog(occasionCategoryRepository);
    const auditLogWriter = overrides?.auditLogWriter ?? new CollectingAuditLogWriter();
    const useCase = new SetRestaurantOccasionCategoriesUseCase(
      restaurantRepository,
      restaurantOccasionCategoryRepository,
      occasionCategoryRepository,
      new FixedClock(fixedNow),
      new UuidGenerator(),
      auditLogWriter,
    );
    return {
      useCase,
      restaurantRepository,
      restaurantSettingsRepository,
      restaurantOccasionCategoryRepository,
      auditLogWriter,
    };
  }

  it('persists the submitted set and returns it sorted by sortOrder', async () => {
    const { useCase, restaurantRepository, restaurantSettingsRepository } = createUseCase();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      occasionCategoryIds: ['cat-family', 'cat-date-night'],
    });

    expect(result.restaurantId).toBe(restaurantId);
    expect(result.categories.map((category) => category.slug)).toEqual(['date-night', 'family']);
  });

  it('deduplicates repeated ids in the request', async () => {
    const { useCase, restaurantRepository, restaurantSettingsRepository } = createUseCase();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      occasionCategoryIds: ['cat-date-night', 'cat-date-night'],
    });

    expect(result.categories).toHaveLength(1);
  });

  it('an id omitted from occasionCategoryIds is unassigned on the next replace', async () => {
    const { useCase, restaurantRepository, restaurantSettingsRepository } = createUseCase();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);
    await useCase.execute({
      actor: baseActor(),
      restaurantId,
      occasionCategoryIds: ['cat-date-night', 'cat-family'],
    });

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      occasionCategoryIds: ['cat-date-night'],
    });

    expect(result.categories.map((category) => category.slug)).toEqual(['date-night']);
  });

  it('accepts an empty occasionCategoryIds array (clears the assignment)', async () => {
    const { useCase, restaurantRepository, restaurantSettingsRepository } = createUseCase();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);
    await useCase.execute({
      actor: baseActor(),
      restaurantId,
      occasionCategoryIds: ['cat-date-night'],
    });

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      occasionCategoryIds: [],
    });

    expect(result.categories).toEqual([]);
  });

  it('rejects an unknown occasionCategoryId without persisting any change', async () => {
    const {
      useCase,
      restaurantRepository,
      restaurantSettingsRepository,
      restaurantOccasionCategoryRepository,
    } = createUseCase();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId,
        occasionCategoryIds: ['does-not-exist'],
      }),
    ).rejects.toBeInstanceOf(UnknownOccasionCategoryException);

    const persisted = await restaurantOccasionCategoryRepository.findAllByRestaurantId(
      RestaurantId.create(restaurantId),
    );
    expect(persisted).toHaveLength(0);
  });

  it('rejects an inactive occasionCategoryId', async () => {
    const { useCase, restaurantRepository, restaurantSettingsRepository } = createUseCase();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId,
        occasionCategoryIds: ['cat-retired'],
      }),
    ).rejects.toBeInstanceOf(UnknownOccasionCategoryException);
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
      occasionCategoryIds: ['cat-date-night'],
      correlationId: 'corr-1',
    });

    expect(auditLogWriter.entries).toHaveLength(1);
    expect(auditLogWriter.entries[0]).toMatchObject({
      actorId: 'user-1',
      actorType: 'User',
      action: 'restaurant.occasion_categories.updated',
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
        occasionCategoryIds: ['cat-date-night'],
      }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });
});
