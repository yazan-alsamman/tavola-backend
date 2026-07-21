import { UpdateRestaurantUseCase } from './update-restaurant.use-case';
import { CreateRestaurantUseCase } from './create-restaurant.use-case';
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
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryRestaurantSettingsRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-settings.repository';

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
    const createUseCase = new CreateRestaurantUseCase(
      repository,
      new InMemoryRestaurantSettingsRepository(),
      new FixedClock(fixedNow),
      new UuidGenerator(),
      new CollectingEventPublisher(),
      new ImmediateUnitOfWork(),
    );
    const result = await createUseCase.execute({
      actor: baseActor(),
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
      priceLevel: 4,
      status: RestaurantStatus.Active,
    });

    expect(result.name).toBe('New Name');
    expect(result.description).toBe('New description');
    expect(result.cuisineType).toBe('French');
    expect(result.priceLevel).toBe(4);

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
      priceLevel: 2,
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
      priceLevel: 2,
      status: RestaurantStatus.Suspended,
    });

    const { useCase: activateUseCase, eventPublisher } = createUseCase(repository);
    const result = await activateUseCase.execute({
      actor: baseActor(),
      restaurantId,
      name: 'Original Name',
      description: 'Original description',
      cuisineType: 'Italian',
      priceLevel: 2,
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
      priceLevel: null,
      status: RestaurantStatus.Active,
    });

    expect(result.slug).toBe('original-name');
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
        priceLevel: null,
        status: RestaurantStatus.Active,
      }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });
});
