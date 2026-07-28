import { ListDiscoverableRestaurantsUseCase } from './list-discoverable-restaurants.use-case';
import { FakeDiscoveryReader } from '../../../../../test/discovery/support/fake-discovery-reader';
import { RestaurantResult } from '@modules/restaurants/application/dto/restaurant.result';

function restaurant(id: string, name: string): RestaurantResult {
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
  };
}

describe('ListDiscoverableRestaurantsUseCase', () => {
  it('returns the public, paginated restaurant listing with no organizationId leaked', async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [
      restaurant('11111111-1111-4111-8111-111111111111', 'The Old Mill'),
      restaurant('11111111-1111-4111-8111-111111111112', 'Sea Breeze'),
    ];

    const useCase = new ListDiscoverableRestaurantsUseCase(reader);
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

    const useCase = new ListDiscoverableRestaurantsUseCase(reader);
    const result = await useCase.execute({ page: 2, limit: 2 });

    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(1);
  });
});
