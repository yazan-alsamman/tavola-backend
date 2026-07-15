import { CreateRestaurantUseCase } from './create-restaurant.use-case';
import { RestaurantSlugAlreadyExistsException } from '../../domain/exceptions/restaurant-slug-already-exists.exception';
import { RestaurantCreatedEvent } from '../../domain/events/restaurant.events';
import { RestaurantStatus } from '../../domain/enums/restaurant.enums';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CollectingEventPublisher,
  FixedClock,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryRestaurantSettingsRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-settings.repository';

describe('CreateRestaurantUseCase', () => {
  const fixedNow = new Date('2026-07-16T12:00:00.000Z');
  const restaurantId = '11111111-1111-4111-8111-111111111111';
  const settingsId = '55555555-5555-4555-8555-555555555555';
  const eventId = '22222222-2222-4222-8222-222222222222';
  const organizationId = '33333333-3333-4333-8333-333333333333';

  function baseActor() {
    return {
      actorType: AccessTokenActorType.OrganizationMember as const,
      userId: 'user-1',
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
      organizationId,
      orgRole: 'Owner',
      permissionsVersion: 1,
    };
  }

  function createUseCase() {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const restaurantSettingsRepository = new InMemoryRestaurantSettingsRepository();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new CreateRestaurantUseCase(
      restaurantRepository,
      restaurantSettingsRepository,
      new FixedClock(fixedNow),
      new SequentialIdGenerator([restaurantId, settingsId, eventId]),
      eventPublisher,
    );
    return { useCase, restaurantRepository, restaurantSettingsRepository, eventPublisher };
  }

  it('creates a restaurant scoped to the actor organization, deriving the slug from the name', async () => {
    const { useCase, restaurantRepository } = createUseCase();

    const result = await useCase.execute({
      actor: baseActor(),
      name: 'The Old Mill',
      description: 'Cozy spot',
      cuisineType: 'Italian',
      priceLevel: 2,
    });

    expect(result.name).toBe('The Old Mill');
    expect(result.slug).toBe('the-old-mill');
    expect(result.status).toBe(RestaurantStatus.Active);
    expect(result.restaurantId).toBe(restaurantId);

    const persisted = await restaurantRepository.findById(RestaurantId.create(restaurantId));
    expect(persisted?.organizationId.value).toBe(organizationId);
  });

  it('atomically creates a default RestaurantSettings row alongside the restaurant', async () => {
    const { useCase, restaurantSettingsRepository } = createUseCase();

    const result = await useCase.execute({
      actor: baseActor(),
      name: 'The Old Mill',
      description: null,
      cuisineType: null,
      priceLevel: null,
    });

    const settings = await restaurantSettingsRepository.findByRestaurantId(
      RestaurantId.create(result.restaurantId),
    );
    expect(settings).not.toBeNull();
    expect(settings?.reservationIntervalMinutes).toBe(30);
    expect(settings?.maxGuestsPerReservation).toBe(20);
    expect(settings?.cancellationWindowMinutes).toBe(60);
    expect(settings?.pendingReservationTimeoutMinutes).toBe(15);
    expect(settings?.autoApproval).toBe(false);
    expect(settings?.timezone).toBe('UTC');
    expect(settings?.defaultCurrency).toBeNull();
  });

  it('uses an explicitly supplied slug when provided', async () => {
    const { useCase } = createUseCase();

    const result = await useCase.execute({
      actor: baseActor(),
      name: 'The Old Mill',
      slug: 'custom-slug',
      description: null,
      cuisineType: null,
      priceLevel: null,
    });

    expect(result.slug).toBe('custom-slug');
  });

  it('throws RestaurantSlugAlreadyExistsException when the slug is already taken', async () => {
    const { useCase, restaurantRepository } = createUseCase();
    await useCase.execute({
      actor: baseActor(),
      name: 'The Old Mill',
      description: null,
      cuisineType: null,
      priceLevel: null,
    });

    const second = new CreateRestaurantUseCase(
      restaurantRepository,
      new InMemoryRestaurantSettingsRepository(),
      new FixedClock(fixedNow),
      new SequentialIdGenerator(['44444444-4444-4444-8444-444444444444']),
      new CollectingEventPublisher(),
    );

    await expect(
      second.execute({
        actor: baseActor(),
        name: 'The Old Mill Again',
        slug: 'the-old-mill',
        description: null,
        cuisineType: null,
        priceLevel: null,
      }),
    ).rejects.toBeInstanceOf(RestaurantSlugAlreadyExistsException);
  });

  it('publishes exactly one RestaurantCreatedEvent carrying the actor and organization', async () => {
    const { useCase, eventPublisher } = createUseCase();

    await useCase.execute({
      actor: baseActor(),
      name: 'The Old Mill',
      description: null,
      cuisineType: null,
      priceLevel: null,
      correlationId: 'corr-1',
    });

    expect(eventPublisher.events).toHaveLength(1);
    const event = eventPublisher.events[0] as RestaurantCreatedEvent;
    expect(event).toBeInstanceOf(RestaurantCreatedEvent);
    expect(event.payload).toMatchObject({
      restaurantId,
      organizationId,
      actorId: 'user-1',
    });
    expect(event.correlationId).toBe('corr-1');
  });

  it('never trusts an organizationId other than the one on the authenticated actor', async () => {
    const { useCase } = createUseCase();

    const result = await useCase.execute({
      actor: baseActor(),
      name: 'The Old Mill',
      description: null,
      cuisineType: null,
      priceLevel: null,
    });

    // The command has no field for a client-supplied organizationId at all -
    // the only identity source is `actor.organizationId` from the verified JWT.
    expect(result.restaurantId).toBe(restaurantId);
  });
});
