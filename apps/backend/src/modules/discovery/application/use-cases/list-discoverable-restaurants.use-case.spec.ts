import { ListDiscoverableRestaurantsUseCase } from './list-discoverable-restaurants.use-case';
import { ListRestaurantIdsWithActiveOfferUseCase } from '@modules/offers/application/use-cases/list-restaurant-ids-with-active-offer.use-case';
import { ListRestaurantIdsWithMenuUseCase } from '@modules/menus/application/use-cases/list-restaurant-ids-with-menu.use-case';
import { FakeDiscoveryReader } from '../../../../../test/discovery/support/fake-discovery-reader';
import { FixedClock } from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryOfferRepository } from '../../../../../test/offers/support/in-memory-offer.repository';
import { InMemoryMenuRepository } from '../../../../../test/menus/support/in-memory-menu.repository';
import {
  testOffer,
  testOfferContent,
} from '../../../../../test/offers/support/offer-test-fixtures';
import { RestaurantResult } from '@modules/restaurants/application/dto/restaurant.result';

function restaurant(
  id: string,
  name: string,
  overrides: Partial<RestaurantResult> = {},
): RestaurantResult {
  return {
    restaurantId: id,
    name,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    logoId: null,
    coverImageId: null,
    description: null,
    cuisineType: 'Italian',
    averageRating: null,
    priceLevel: 2,
    status: 'Active',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildUseCase(reader: FakeDiscoveryReader, now = new Date('2026-08-15T00:00:00.000Z')) {
  const offerRepository = new InMemoryOfferRepository();
  const listRestaurantIdsWithActiveOfferUseCase = new ListRestaurantIdsWithActiveOfferUseCase(
    offerRepository,
    new FixedClock(now),
  );
  const listRestaurantIdsWithMenuUseCase = new ListRestaurantIdsWithMenuUseCase(
    new InMemoryMenuRepository(),
  );
  return {
    useCase: new ListDiscoverableRestaurantsUseCase(
      reader,
      listRestaurantIdsWithActiveOfferUseCase,
      listRestaurantIdsWithMenuUseCase,
    ),
    offerRepository,
  };
}

describe('ListDiscoverableRestaurantsUseCase', () => {
  it('returns the public, paginated restaurant listing with no organizationId leaked', async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [
      restaurant('11111111-1111-4111-8111-111111111111', 'The Old Mill'),
      restaurant('11111111-1111-4111-8111-111111111112', 'Sea Breeze'),
    ];

    const { useCase } = buildUseCase(reader);
    const result = await useCase.execute({ page: 1, limit: 20 });

    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).not.toHaveProperty('organizationId');
  });

  it('respects pagination', async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [
      restaurant('11111111-1111-4111-8111-111111111111', 'A'),
      restaurant('11111111-1111-4111-8111-111111111112', 'B'),
      restaurant('11111111-1111-4111-8111-111111111113', 'C'),
    ];

    const { useCase } = buildUseCase(reader);
    const result = await useCase.execute({ page: 2, limit: 2 });

    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(1);
  });

  it('filters by q (name-only ILIKE, D5)', async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [
      restaurant('11111111-1111-4111-8111-111111111111', 'The Old Mill'),
      restaurant('11111111-1111-4111-8111-111111111112', 'Sea Breeze'),
    ];

    const { useCase } = buildUseCase(reader);
    const result = await useCase.execute({ page: 1, limit: 20, q: 'old' });

    expect(result.items.map((r) => r.restaurantId)).toEqual([
      '11111111-1111-4111-8111-111111111111',
    ]);
  });

  it('filters by cuisineId via the relational taxonomy, not cuisineType (D6)', async () => {
    const reader = new FakeDiscoveryReader();
    const italian = restaurant('11111111-1111-4111-8111-111111111111', 'Roma', {
      cuisineType: 'NotItalian',
    });
    const other = restaurant('11111111-1111-4111-8111-111111111112', 'Sea Breeze');
    reader.restaurants = [italian, other];
    reader.restaurantCuisineCategoryIds.set(italian.restaurantId, ['cuisine-italian']);

    const { useCase } = buildUseCase(reader);
    const result = await useCase.execute({ page: 1, limit: 20, cuisineId: 'cuisine-italian' });

    expect(result.items.map((r) => r.restaurantId)).toEqual([italian.restaurantId]);
  });

  it('filters by minRating against the persisted averageRating', async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [
      restaurant('11111111-1111-4111-8111-111111111111', 'High', { averageRating: 4.5 }),
      restaurant('11111111-1111-4111-8111-111111111112', 'Low', { averageRating: 2.0 }),
      restaurant('11111111-1111-4111-8111-111111111113', 'None', { averageRating: null }),
    ];

    const { useCase } = buildUseCase(reader);
    const result = await useCase.execute({ page: 1, limit: 20, minRating: 4 });

    expect(result.items.map((r) => r.restaurantId)).toEqual([
      '11111111-1111-4111-8111-111111111111',
    ]);
  });

  it('sorts by rating desc with nulls last regardless of direction (D7/D17)', async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [
      restaurant('11111111-1111-4111-8111-111111111111', 'NoRating', { averageRating: null }),
      restaurant('11111111-1111-4111-8111-111111111112', 'Mid', { averageRating: 3 }),
      restaurant('11111111-1111-4111-8111-111111111113', 'Top', { averageRating: 5 }),
    ];

    const { useCase } = buildUseCase(reader);
    const result = await useCase.execute({ page: 1, limit: 20, sort: 'rating' });

    expect(result.items.map((r) => r.restaurantId)).toEqual([
      '11111111-1111-4111-8111-111111111113',
      '11111111-1111-4111-8111-111111111112',
      '11111111-1111-4111-8111-111111111111',
    ]);
  });

  it('annotates hasActiveOffer per D9, never recomputing Offer rules itself', async () => {
    const reader = new FakeDiscoveryReader();
    const withOffer = restaurant('11111111-1111-4111-8111-111111111111', 'HasOffer');
    const withoutOffer = restaurant('11111111-1111-4111-8111-111111111112', 'NoOffer');
    reader.restaurants = [withOffer, withoutOffer];

    const { useCase, offerRepository } = buildUseCase(reader);
    const activeOffer = testOffer({
      id: '22222222-2222-4222-8222-222222222221',
      restaurantId: withOffer.restaurantId,
      content: testOfferContent({
        startsAt: new Date('2026-08-01T00:00:00.000Z'),
        endsAt: new Date('2026-08-31T00:00:00.000Z'),
      }),
    }).publish(new Date('2026-08-01T10:00:00.000Z'));
    await offerRepository.seed(activeOffer);

    const result = await useCase.execute({ page: 1, limit: 20 });

    const withOfferResult = result.items.find((r) => r.restaurantId === withOffer.restaurantId);
    const withoutOfferResult = result.items.find(
      (r) => r.restaurantId === withoutOffer.restaurantId,
    );
    expect(withOfferResult?.hasActiveOffer).toBe(true);
    expect(withoutOfferResult?.hasActiveOffer).toBe(false);
  });

  it('returns zero results without error for a filter combination that matches nothing', async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [restaurant('11111111-1111-4111-8111-111111111111', 'Only One')];

    const { useCase } = buildUseCase(reader);
    const result = await useCase.execute({ page: 1, limit: 20, q: 'does-not-exist' });

    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});
