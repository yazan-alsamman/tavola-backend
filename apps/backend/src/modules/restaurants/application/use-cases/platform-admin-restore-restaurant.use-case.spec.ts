import { PlatformAdminRestoreRestaurantUseCase } from './platform-admin-restore-restaurant.use-case';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { RestaurantNotSoftDeletedException } from '../../domain/exceptions/restaurant-not-soft-deleted.exception';
import { RestaurantRestoredEvent } from '../../domain/events/restaurant.events';
import { Restaurant } from '../../domain/entities/restaurant.entity';
import { RestaurantStatus } from '../../domain/enums/restaurant.enums';
import {
  PlatformAdminRestaurantLookup,
  PlatformAdminRestaurantLookupReaderPort,
} from '../ports/platform-admin-restaurant-lookup-reader.port';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
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

describe('PlatformAdminRestoreRestaurantUseCase', () => {
  const now = new Date('2026-08-04T12:00:00.000Z');
  const restaurantId = '11111111-1111-4111-8111-111111111111';
  const organizationId = '22222222-2222-4222-8222-222222222222';
  const actorId = '33333333-3333-4333-8333-333333333333';

  function build() {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const lookupRows = new Map<string, PlatformAdminRestaurantLookup>([
      [restaurantId, { restaurantId, organizationId }],
    ]);
    const lookupReader = new FakeLookupReader(lookupRows);
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new PlatformAdminRestoreRestaurantUseCase(
      lookupReader,
      restaurantRepository,
      new RecordingTenantContextPort(),
      new FixedClock(now),
      new SequentialIdGenerator(['eeeeeeee-1111-4111-8111-111111111111']),
      eventPublisher,
    );
    return { useCase, restaurantRepository, eventPublisher };
  }

  function buildRestaurant(deletedAt: Date | null): Restaurant {
    return Restaurant.create({
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
      status: RestaurantStatus.Active,
      createdAt: now,
      updatedAt: now,
      deletedAt,
    });
  }

  it('restores a soft-deleted restaurant, closing the standing "no restore capability" gap (ADR-034 §3)', async () => {
    const { useCase, restaurantRepository, eventPublisher } = build();
    await restaurantRepository.save(buildRestaurant(now));

    const result = await useCase.execute({ restaurantId, actorId });

    expect(result.deletedAt).toBeNull();
    const event = eventPublisher.events[0] as RestaurantRestoredEvent;
    expect(event).toBeInstanceOf(RestaurantRestoredEvent);
    expect(event.payload).toMatchObject({ restaurantId, organizationId, actorId });
  });

  it('uses findByIdIncludingDeleted, unlike every other lifecycle operation - a soft-deleted restaurant is visible here', async () => {
    const { useCase, restaurantRepository } = build();
    await restaurantRepository.save(buildRestaurant(now));

    await useCase.execute({ restaurantId, actorId });

    const restored = await restaurantRepository.findByIdIncludingDeleted(
      RestaurantId.create(restaurantId),
    );
    expect(restored).not.toBeNull();
    expect(restored?.isSoftDeleted()).toBe(false);
  });

  it('rejects (409) restoring a restaurant that is not currently deleted', async () => {
    const { useCase, restaurantRepository } = build();
    await restaurantRepository.save(buildRestaurant(null));

    await expect(useCase.execute({ restaurantId, actorId })).rejects.toThrow(
      RestaurantNotSoftDeletedException,
    );
  });

  it('rejects (404) an unknown restaurant id (IDOR-safe)', async () => {
    const { useCase } = build();

    await expect(useCase.execute({ restaurantId: 'unknown-id', actorId })).rejects.toThrow(
      RestaurantNotFoundException,
    );
  });
});
