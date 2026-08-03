import { NearbyRestaurantsUseCase } from './nearby-restaurants.use-case';
import { ListRestaurantIdsWithActiveOfferUseCase } from '@modules/offers/application/use-cases/list-restaurant-ids-with-active-offer.use-case';
import { ListRestaurantIdsWithMenuUseCase } from '@modules/menus/application/use-cases/list-restaurant-ids-with-menu.use-case';
import { FakeDiscoveryReader } from '../../../../../test/discovery/support/fake-discovery-reader';
import { FixedClock } from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryOfferRepository } from '../../../../../test/offers/support/in-memory-offer.repository';
import { InMemoryMenuRepository } from '../../../../../test/menus/support/in-memory-menu.repository';
import { RestaurantResult } from '@modules/restaurants/application/dto/restaurant.result';
import { BranchResult } from '@modules/branches/application/dto/branch.result';

const DAMASCUS = { lat: 33.5138, lng: 36.2765 };
// ~300km from Damascus - well outside every radius used below.
const ALEPPO = { lat: 36.2021, lng: 37.1343 };

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

function branch(
  id: string,
  restaurantId: string,
  lat: number | null,
  lng: number | null,
): BranchResult {
  return {
    branchId: id,
    restaurantId,
    city: 'Damascus',
    district: null,
    address: '1 Main St',
    latitude: lat,
    longitude: lng,
    countryCode: 'SY',
    currency: 'SYP',
    timezone: 'Asia/Damascus',
    phone: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
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
  return new NearbyRestaurantsUseCase(
    reader,
    listRestaurantIdsWithActiveOfferUseCase,
    listRestaurantIdsWithMenuUseCase,
  );
}

describe('NearbyRestaurantsUseCase (D2-D4)', () => {
  it('includes a restaurant inside the radius and excludes one outside it', async () => {
    const reader = new FakeDiscoveryReader();
    const inside = restaurant('11111111-1111-4111-8111-111111111111', 'Inside');
    const outside = restaurant('11111111-1111-4111-8111-111111111112', 'Outside');
    reader.restaurants = [inside, outside];
    reader.branches = [
      branch(
        '22222222-2222-4222-8222-222222222221',
        inside.restaurantId,
        DAMASCUS.lat,
        DAMASCUS.lng,
      ),
      branch('22222222-2222-4222-8222-222222222222', outside.restaurantId, ALEPPO.lat, ALEPPO.lng),
    ];

    const useCase = buildUseCase(reader);
    const result = await useCase.execute({
      lat: DAMASCUS.lat,
      lng: DAMASCUS.lng,
      radiusKm: 5,
      page: 1,
      limit: 20,
    });

    expect(result.items.map((r) => r.restaurantId)).toEqual([inside.restaurantId]);
  });

  it('excludes a branch with NULL coordinates from qualifying (D13/D4)', async () => {
    const reader = new FakeDiscoveryReader();
    const noCoords = restaurant('11111111-1111-4111-8111-111111111111', 'NoCoords');
    reader.restaurants = [noCoords];
    reader.branches = [
      branch('22222222-2222-4222-8222-222222222221', noCoords.restaurantId, null, null),
    ];

    const useCase = buildUseCase(reader);
    const result = await useCase.execute({
      lat: DAMASCUS.lat,
      lng: DAMASCUS.lng,
      radiusKm: 50,
      page: 1,
      limit: 20,
    });

    expect(result.items).toHaveLength(0);
  });

  it('deduplicates a Restaurant with two qualifying Branches, keeping the nearest one (D2)', async () => {
    const reader = new FakeDiscoveryReader();
    const twoB = restaurant('11111111-1111-4111-8111-111111111111', 'TwoBranches');
    reader.restaurants = [twoB];
    const far = branch(
      '22222222-2222-4222-8222-222222222221',
      twoB.restaurantId,
      DAMASCUS.lat + 0.03,
      DAMASCUS.lng,
    );
    const near = branch(
      '22222222-2222-4222-8222-222222222222',
      twoB.restaurantId,
      DAMASCUS.lat + 0.001,
      DAMASCUS.lng,
    );
    reader.branches = [far, near];

    const useCase = buildUseCase(reader);
    const result = await useCase.execute({
      lat: DAMASCUS.lat,
      lng: DAMASCUS.lng,
      radiusKm: 10,
      page: 1,
      limit: 20,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].nearestBranchId).toBe(near.branchId);
  });

  it('orders results by distance ascending with a deterministic restaurantId tie-break', async () => {
    const reader = new FakeDiscoveryReader();
    const near = restaurant('11111111-1111-4111-8111-111111111112', 'Near');
    const nearer = restaurant('11111111-1111-4111-8111-111111111111', 'Nearer');
    reader.restaurants = [near, nearer];
    reader.branches = [
      branch(
        '22222222-2222-4222-8222-222222222221',
        near.restaurantId,
        DAMASCUS.lat + 0.02,
        DAMASCUS.lng,
      ),
      branch(
        '22222222-2222-4222-8222-222222222222',
        nearer.restaurantId,
        DAMASCUS.lat + 0.005,
        DAMASCUS.lng,
      ),
    ];

    const useCase = buildUseCase(reader);
    const result = await useCase.execute({
      lat: DAMASCUS.lat,
      lng: DAMASCUS.lng,
      radiusKm: 10,
      page: 1,
      limit: 20,
    });

    expect(result.items.map((r) => r.restaurantId)).toEqual([
      nearer.restaurantId,
      near.restaurantId,
    ]);
    expect(result.items[0].distanceKm).toBeLessThan(result.items[1].distanceKm);
  });

  it('combines the geo filter with the same q/taxonomy/price/rating filters as plain search', async () => {
    const reader = new FakeDiscoveryReader();
    const matching = restaurant('11111111-1111-4111-8111-111111111111', 'Old Mill', {
      priceLevel: 3,
    });
    const wrongName = restaurant('11111111-1111-4111-8111-111111111112', 'Sea Breeze', {
      priceLevel: 3,
    });
    reader.restaurants = [matching, wrongName];
    reader.branches = [
      branch(
        '22222222-2222-4222-8222-222222222221',
        matching.restaurantId,
        DAMASCUS.lat,
        DAMASCUS.lng,
      ),
      branch(
        '22222222-2222-4222-8222-222222222222',
        wrongName.restaurantId,
        DAMASCUS.lat,
        DAMASCUS.lng,
      ),
    ];

    const useCase = buildUseCase(reader);
    const result = await useCase.execute({
      lat: DAMASCUS.lat,
      lng: DAMASCUS.lng,
      radiusKm: 5,
      page: 1,
      limit: 20,
      q: 'Old',
      priceLevel: 3,
    });

    expect(result.items.map((r) => r.restaurantId)).toEqual([matching.restaurantId]);
  });
});
