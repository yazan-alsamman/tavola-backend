import { GetDiscoverableRestaurantUseCase } from './get-discoverable-restaurant.use-case';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { FakeDiscoveryReader } from '../../../../../test/discovery/support/fake-discovery-reader';
import { RestaurantResult } from '@modules/restaurants/application/dto/restaurant.result';

const restaurantId = '11111111-1111-4111-8111-111111111111';

function restaurant(): RestaurantResult {
  return {
    restaurantId,
    name: 'The Old Mill',
    slug: 'the-old-mill',
    logoId: null,
    coverImageId: null,
    description: 'Cozy spot.',
    cuisineType: 'Italian',
    averageRating: 4.5,
    priceLevel: 2,
    status: 'Active',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

describe('GetDiscoverableRestaurantUseCase', () => {
  it('returns a discoverable restaurant by id, from any organization', async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [restaurant()];

    const useCase = new GetDiscoverableRestaurantUseCase(reader);
    const result = await useCase.execute({ restaurantId });
    expect(result.name).toBe('The Old Mill');
  });

  it('404s for an unknown restaurant id', async () => {
    const reader = new FakeDiscoveryReader();
    const useCase = new GetDiscoverableRestaurantUseCase(reader);
    await expect(useCase.execute({ restaurantId })).rejects.toBeInstanceOf(
      RestaurantNotFoundException,
    );
  });
});
