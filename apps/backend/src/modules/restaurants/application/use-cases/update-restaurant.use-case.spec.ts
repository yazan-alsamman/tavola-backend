import { InvalidRestaurantProfileException } from '../../domain/exceptions/invalid-restaurant-profile.exception';
import { UpdateRestaurantUseCase } from './update-restaurant.use-case';
import { CreateRestaurantUseCase } from './create-restaurant.use-case';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { UnknownCuisineTypeException } from '../../domain/exceptions/unknown-cuisine-type.exception';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import {
  RestaurantActivatedEvent,
  RestaurantSuspendedEvent,
  RestaurantUpdatedEvent,
} from '../../domain/events/restaurant.events';
import { RestaurantStatus } from '../../domain/enums/restaurant.enums';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  UuidGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { createPermissiveSubscriptionFixture } from '../../../../../test/subscriptions/support/permissive-subscription-fixture';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryRestaurantSettingsRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-settings.repository';
import { createSeededCuisineCategoryRepository } from '../../../../../test/restaurants/support/in-memory-cuisine-category.repository';

describe('UpdateRestaurantUseCase', () => {
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

  async function seedRestaurant(repository: InMemoryRestaurantRepository): Promise<string> {
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
      new UuidGenerator(),
      new CollectingEventPublisher(),
      new ImmediateUnitOfWork(),
      createSeededCuisineCategoryRepository(),
    );
    const result = await createUseCase.execute({
      organizationId: baseActor().organizationId,
      actorId: baseActor().userId,
      name: 'Original Name',
      description: 'Original description',
      cuisineType: 'Italian',
      priceLevel: 2,
    });
    return result.restaurantId;
  }

  function createUseCase(repository: InMemoryRestaurantRepository) {
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new UpdateRestaurantUseCase(
      repository,
      new FixedClock(fixedNow),
      new UuidGenerator(),
      eventPublisher,
      createSeededCuisineCategoryRepository(),
    );
    return { useCase, eventPublisher };
  }

  it('updates profile fields and publishes RestaurantUpdatedEvent when status is unchanged', async () => {
    const repository = new InMemoryRestaurantRepository();
    const restaurantId = await seedRestaurant(repository);
    const { useCase, eventPublisher } = createUseCase(repository);

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      name: 'New Name',
      description: 'New description',
      cuisineType: 'French',
      status: RestaurantStatus.Active,
    });

    expect(result.name).toBe('New Name');
    expect(result.description).toBe('New description');
    expect(result.cuisineType).toBe('French');
    // ADR-046: the price level is computed from the menu, never set here.
    expect(result.priceLevel).toBe(2);

    expect(eventPublisher.events).toHaveLength(1);
    expect(eventPublisher.events[0]).toBeInstanceOf(RestaurantUpdatedEvent);
  });

  it('publishes RestaurantSuspendedEvent instead of RestaurantUpdatedEvent when status transitions to Suspended', async () => {
    const repository = new InMemoryRestaurantRepository();
    const restaurantId = await seedRestaurant(repository);
    const { useCase, eventPublisher } = createUseCase(repository);

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      name: 'Original Name',
      description: 'Original description',
      cuisineType: 'Italian',
      status: RestaurantStatus.Suspended,
    });

    expect(result.status).toBe(RestaurantStatus.Suspended);
    expect(eventPublisher.events).toHaveLength(1);
    expect(eventPublisher.events[0]).toBeInstanceOf(RestaurantSuspendedEvent);
  });

  it('publishes RestaurantActivatedEvent when status transitions back to Active', async () => {
    const repository = new InMemoryRestaurantRepository();
    const restaurantId = await seedRestaurant(repository);
    const { useCase: suspendUseCase } = createUseCase(repository);
    await suspendUseCase.execute({
      actor: baseActor(),
      restaurantId,
      name: 'Original Name',
      description: 'Original description',
      cuisineType: 'Italian',
      status: RestaurantStatus.Suspended,
    });

    const { useCase: activateUseCase, eventPublisher } = createUseCase(repository);
    const result = await activateUseCase.execute({
      actor: baseActor(),
      restaurantId,
      name: 'Original Name',
      description: 'Original description',
      cuisineType: 'Italian',
      status: RestaurantStatus.Active,
    });

    expect(result.status).toBe(RestaurantStatus.Active);
    expect(eventPublisher.events).toHaveLength(1);
    expect(eventPublisher.events[0]).toBeInstanceOf(RestaurantActivatedEvent);
  });

  it('never changes organizationId or slug', async () => {
    const repository = new InMemoryRestaurantRepository();
    const restaurantId = await seedRestaurant(repository);
    const { useCase } = createUseCase(repository);

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      name: 'New Name',
      description: null,
      cuisineType: null,
      status: RestaurantStatus.Active,
    });

    expect(result.slug).toBe('original-name');
  });

  it('stores the name and description in both languages (ADR-052)', async () => {
    const repository = new InMemoryRestaurantRepository();
    const restaurantId = await seedRestaurant(repository);
    const { useCase } = createUseCase(repository);

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      nameAr: 'المطحنة',
      nameEn: 'The Mill',
      description: null,
      descriptionAr: 'مطعم قديم',
      descriptionEn: 'An old place',
      cuisineType: null,
      status: RestaurantStatus.Active,
    });

    expect(result).toMatchObject({
      name: 'المطحنة',
      nameAr: 'المطحنة',
      nameEn: 'The Mill',
      description: 'مطعم قديم',
      descriptionEn: 'An old place',
    });
  });

  it('keeps the translations when an older client resends the same single name', async () => {
    const repository = new InMemoryRestaurantRepository();
    const restaurantId = await seedRestaurant(repository);
    const { useCase } = createUseCase(repository);
    await useCase.execute({
      actor: baseActor(),
      restaurantId,
      nameAr: 'المطحنة',
      nameEn: 'The Mill',
      description: null,
      cuisineType: null,
      status: RestaurantStatus.Active,
    });

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      name: 'المطحنة',
      description: null,
      cuisineType: 'Oriental',
      status: RestaurantStatus.Active,
    });

    expect(result.nameEn).toBe('The Mill');
    expect(result.cuisineType).toBe('Oriental');
  });

  it('rejects a profile with no name in any language', async () => {
    const repository = new InMemoryRestaurantRepository();
    const restaurantId = await seedRestaurant(repository);
    const { useCase } = createUseCase(repository);

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId,
        nameAr: ' ',
        nameEn: null,
        description: null,
        cuisineType: null,
        status: RestaurantStatus.Active,
      }),
    ).rejects.toBeInstanceOf(InvalidRestaurantProfileException);
  });

  it('throws RestaurantNotFoundException for an unknown id', async () => {
    const repository = new InMemoryRestaurantRepository();
    const { useCase } = createUseCase(repository);

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        name: 'New Name',
        description: null,
        cuisineType: null,
        status: RestaurantStatus.Active,
      }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });

  describe('cuisineType (closed list of active cuisine categories)', () => {
    function update(
      useCase: UpdateRestaurantUseCase,
      restaurantId: string,
      cuisineType: string | null,
    ) {
      return useCase.execute({
        actor: baseActor(),
        restaurantId,
        name: 'Original Name',
        description: 'Original description',
        cuisineType,
        status: RestaurantStatus.Active,
      });
    }

    it('stores the canonical category name for a case-insensitive name or slug match', async () => {
      const repository = new InMemoryRestaurantRepository();
      const restaurantId = await seedRestaurant(repository);
      const { useCase } = createUseCase(repository);

      expect((await update(useCase, restaurantId, 'oriental')).cuisineType).toBe('Oriental');
      expect((await update(useCase, restaurantId, '  FRENCH ')).cuisineType).toBe('French');
    });

    it('treats a blank value as no cuisine type', async () => {
      const repository = new InMemoryRestaurantRepository();
      const restaurantId = await seedRestaurant(repository);
      const { useCase } = createUseCase(repository);

      expect((await update(useCase, restaurantId, '   ')).cuisineType).toBeNull();
    });

    it('rejects a value that is not an active cuisine category', async () => {
      const repository = new InMemoryRestaurantRepository();
      const restaurantId = await seedRestaurant(repository);
      const { useCase, eventPublisher } = createUseCase(repository);

      await expect(update(useCase, restaurantId, 'Fusion')).rejects.toBeInstanceOf(
        UnknownCuisineTypeException,
      );
      expect(eventPublisher.events).toHaveLength(0);
    });

    it('keeps a legacy free-text value when it is re-sent unchanged, but rejects a new free-text value', async () => {
      const repository = new InMemoryRestaurantRepository();
      const restaurantId = await seedRestaurant(repository);
      const existing = await repository.findById(RestaurantId.create(restaurantId));
      await repository.save(
        existing!.updateProfile(
          {
            name: existing!.name,
            nameAr: existing!.nameAr,
            nameEn: existing!.nameEn,
            description: existing!.description,
            descriptionAr: existing!.descriptionAr,
            descriptionEn: existing!.descriptionEn,
            cuisineType: 'مشاوي',
          },
          fixedNow,
        ),
      );
      const { useCase } = createUseCase(repository);

      expect((await update(useCase, restaurantId, 'مشاوي')).cuisineType).toBe('مشاوي');
      await expect(update(useCase, restaurantId, 'حلويات')).rejects.toBeInstanceOf(
        UnknownCuisineTypeException,
      );
    });
  });
});
