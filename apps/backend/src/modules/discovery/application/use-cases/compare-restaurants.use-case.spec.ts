import { CompareRestaurantsUseCase } from './compare-restaurants.use-case';
import { ListRestaurantIdsWithActiveOfferUseCase } from '@modules/offers/application/use-cases/list-restaurant-ids-with-active-offer.use-case';
import { ListRestaurantIdsWithMenuUseCase } from '@modules/menus/application/use-cases/list-restaurant-ids-with-menu.use-case';
import { FakeDiscoveryReader } from '../../../../../test/discovery/support/fake-discovery-reader';
import { FixedClock } from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryOfferRepository } from '../../../../../test/offers/support/in-memory-offer.repository';
import { InMemoryMenuRepository } from '../../../../../test/menus/support/in-memory-menu.repository';
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

function buildUseCase(reader: FakeDiscoveryReader) {
  const offerRepository = new InMemoryOfferRepository();
  const listRestaurantIdsWithActiveOfferUseCase = new ListRestaurantIdsWithActiveOfferUseCase(
    offerRepository,
    new FixedClock(new Date('2026-08-15T00:00:00.000Z')),
  );
  const listRestaurantIdsWithMenuUseCase = new ListRestaurantIdsWithMenuUseCase(
    new InMemoryMenuRepository(),
  );
  return new CompareRestaurantsUseCase(
    reader,
    listRestaurantIdsWithActiveOfferUseCase,
    listRestaurantIdsWithMenuUseCase,
  );
}

describe('CompareRestaurantsUseCase (D15/D18/D19)', () => {
  const a = restaurant('11111111-1111-4111-8111-111111111111', 'A');
  const b = restaurant('11111111-1111-4111-8111-111111111112', 'B');
  const c = restaurant('11111111-1111-4111-8111-111111111113', 'C');
  const suspended = restaurant('11111111-1111-4111-8111-111111111114', 'Suspended', {
    status: 'Suspended',
  });

  it('preserves the caller-requested restaurantIds order, not database order', async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [a, b, c];

    const useCase = buildUseCase(reader);
    const result = await useCase.execute({
      restaurantIds: [c.restaurantId, a.restaurantId, b.restaurantId],
    });

    expect(result.items.map((r) => r.restaurantId)).toEqual([
      c.restaurantId,
      a.restaurantId,
      b.restaurantId,
    ]);
  });

  it('silently omits an unknown id rather than erroring (D19 - no existence oracle)', async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [a, b];

    const useCase = buildUseCase(reader);
    const result = await useCase.execute({
      restaurantIds: [a.restaurantId, '99999999-9999-4999-8999-999999999999', b.restaurantId],
    });

    expect(result.items.map((r) => r.restaurantId)).toEqual([a.restaurantId, b.restaurantId]);
  });

  it('silently omits a Suspended (non-visible) restaurant the same way as an unknown id', async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [a, suspended];

    const useCase = buildUseCase(reader);
    const result = await useCase.execute({
      restaurantIds: [a.restaurantId, suspended.restaurantId],
    });

    expect(result.items.map((r) => r.restaurantId)).toEqual([a.restaurantId]);
  });

  it('returns an empty items array (never throws) when none of the requested ids are visible', async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [suspended];

    const useCase = buildUseCase(reader);
    const result = await useCase.execute({
      restaurantIds: [suspended.restaurantId, '99999999-9999-4999-8999-999999999999'],
    });

    expect(result.items).toEqual([]);
  });
});
