import { DeleteRestaurantUseCase } from './delete-restaurant.use-case';
import { GetRestaurantUseCase } from './get-restaurant.use-case';
import { CreateRestaurantUseCase } from './create-restaurant.use-case';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { RestaurantDeletedEvent } from '../../domain/events/restaurant.events';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  CollectingEventPublisher,
  FixedClock,
  UuidGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryRestaurantSettingsRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-settings.repository';

describe('DeleteRestaurantUseCase', () => {
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

  it('soft-deletes the restaurant so subsequent GET reports it as not found', async () => {
    const repository = new InMemoryRestaurantRepository();
    const restaurantId = await seedRestaurant(repository);
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new DeleteRestaurantUseCase(
      repository,
      new FixedClock(fixedNow),
      new UuidGenerator(),
      eventPublisher,
    );

    await useCase.execute({ actor: baseActor(), restaurantId });

    const getUseCase = new GetRestaurantUseCase(repository);
    await expect(getUseCase.execute({ actor: baseActor(), restaurantId })).rejects.toBeInstanceOf(
      RestaurantNotFoundException,
    );
  });

  it('publishes exactly one RestaurantDeletedEvent', async () => {
    const repository = new InMemoryRestaurantRepository();
    const restaurantId = await seedRestaurant(repository);
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new DeleteRestaurantUseCase(
      repository,
      new FixedClock(fixedNow),
      new UuidGenerator(),
      eventPublisher,
    );

    await useCase.execute({ actor: baseActor(), restaurantId, correlationId: 'corr-1' });

    expect(eventPublisher.events).toHaveLength(1);
    const event = eventPublisher.events[0] as RestaurantDeletedEvent;
    expect(event).toBeInstanceOf(RestaurantDeletedEvent);
    expect(event.payload).toMatchObject({ restaurantId, actorId: 'user-1' });
    expect(event.correlationId).toBe('corr-1');
  });

  it('throws RestaurantNotFoundException for an unknown id', async () => {
    const repository = new InMemoryRestaurantRepository();
    const useCase = new DeleteRestaurantUseCase(
      repository,
      new FixedClock(fixedNow),
      new UuidGenerator(),
      new CollectingEventPublisher(),
    );

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });

  it('is idempotent-safe: deleting an already-deleted restaurant throws not-found, not a silent success', async () => {
    const repository = new InMemoryRestaurantRepository();
    const restaurantId = await seedRestaurant(repository);
    const useCase = new DeleteRestaurantUseCase(
      repository,
      new FixedClock(fixedNow),
      new UuidGenerator(),
      new CollectingEventPublisher(),
    );

    await useCase.execute({ actor: baseActor(), restaurantId });

    await expect(useCase.execute({ actor: baseActor(), restaurantId })).rejects.toBeInstanceOf(
      RestaurantNotFoundException,
    );
  });
});
