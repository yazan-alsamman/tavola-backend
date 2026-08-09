import { PlatformAdminReactivateRestaurantUseCase } from './platform-admin-reactivate-restaurant.use-case';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { RestaurantActivatedEvent } from '../../domain/events/restaurant.events';
import { Restaurant } from '../../domain/entities/restaurant.entity';
import { RestaurantStatus } from '../../domain/enums/restaurant.enums';
import {
  PlatformAdminRestaurantLookup,
  PlatformAdminRestaurantLookupReaderPort,
} from '../ports/platform-admin-restaurant-lookup-reader.port';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import {
  CollectingEventPublisher,
  FixedClock,
  RecordingTenantContextPort,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

class FakeLookupReader implements PlatformAdminRestaurantLookupReaderPort {
  constructor(private readonly rows: Map<string, PlatformAdminRestaurantLookup>) {}
  async findOrganizationIdByRestaurantId(
    restaurantId: string,
  ): Promise<PlatformAdminRestaurantLookup | null> {
    return this.rows.get(restaurantId) ?? null;
  }
}

describe('PlatformAdminReactivateRestaurantUseCase', () => {
  const now = new Date('2026-08-06T12:00:00.000Z');
  const restaurantId = '11111111-1111-4111-8111-111111111111';
  const organizationId = '22222222-2222-4222-8222-222222222222';
  const actorId = '33333333-3333-4333-8333-333333333333';

  function build(seedLookup = true) {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const lookupRows = new Map<string, PlatformAdminRestaurantLookup>();
    if (seedLookup) {
      lookupRows.set(restaurantId, { restaurantId, organizationId });
    }
    const lookupReader = new FakeLookupReader(lookupRows);
    const tenantContext = new RecordingTenantContextPort();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new PlatformAdminReactivateRestaurantUseCase(
      lookupReader,
      restaurantRepository,
      tenantContext,
      new FixedClock(now),
      new SequentialIdGenerator([
        'eeeeeeee-1111-4111-8111-111111111111',
        'eeeeeeee-2222-4222-8222-222222222222',
      ]),
      eventPublisher,
    );
    return { useCase, restaurantRepository, tenantContext, eventPublisher };
  }

  async function seedSuspendedRestaurant(repository: InMemoryRestaurantRepository): Promise<void> {
    await repository.save(
      Restaurant.create({
        id: restaurantId,
        organizationId,
        name: 'Test Restaurant',
        slug: 'test-restaurant',
        logoId: null,
        coverImageId: null,
        description: null,
        cuisineType: null,
        averageRating: null,
        priceLevel: null,
        status: RestaurantStatus.Suspended,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }),
    );
  }

  it('reactivates the restaurant and publishes RestaurantActivatedEvent', async () => {
    const { useCase, restaurantRepository, eventPublisher } = build();
    await seedSuspendedRestaurant(restaurantRepository);

    const result = await useCase.execute({ restaurantId, actorId, correlationId: 'corr-1' });

    expect(result.status).toBe(RestaurantStatus.Active);
    const event = eventPublisher.events[0] as RestaurantActivatedEvent;
    expect(event).toBeInstanceOf(RestaurantActivatedEvent);
    expect(event.payload).toMatchObject({ restaurantId, organizationId, actorId });
  });

  it('is idempotent - reactivating an already-Active restaurant is a no-op, matching Restaurant.activate()', async () => {
    const { useCase, restaurantRepository } = build();
    await seedSuspendedRestaurant(restaurantRepository);
    await useCase.execute({ restaurantId, actorId });

    await expect(useCase.execute({ restaurantId, actorId })).resolves.toMatchObject({
      status: RestaurantStatus.Active,
    });
  });

  it('M1: a no-op repeat call publishes no second RestaurantActivatedEvent and writes no second audit row', async () => {
    const { useCase, restaurantRepository, eventPublisher } = build();
    await seedSuspendedRestaurant(restaurantRepository);

    await useCase.execute({ restaurantId, actorId });
    expect(eventPublisher.events).toHaveLength(1);

    await useCase.execute({ restaurantId, actorId });
    expect(eventPublisher.events).toHaveLength(1);
  });

  it('rejects (404) when the lookup cannot resolve the restaurant id at all - no organizationId is ever bound (IDOR-safe)', async () => {
    const { useCase, tenantContext } = build(false);

    await expect(useCase.execute({ restaurantId, actorId })).rejects.toThrow(
      RestaurantNotFoundException,
    );
    expect(tenantContext.boundContexts).toHaveLength(0);
  });
});
