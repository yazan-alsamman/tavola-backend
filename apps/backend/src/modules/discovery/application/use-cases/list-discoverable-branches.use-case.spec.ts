import { ListDiscoverableBranchesUseCase } from './list-discoverable-branches.use-case';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { FakeDiscoveryReader } from '../../../../../test/discovery/support/fake-discovery-reader';
import { RestaurantResult } from '@modules/restaurants/application/dto/restaurant.result';
import { BranchResult } from '@modules/branches/application/dto/branch.result';

const restaurantId = '11111111-1111-4111-8111-111111111111';
const otherRestaurantId = '11111111-1111-4111-8111-111111111199';

function restaurant(id: string): RestaurantResult {
  return {
    restaurantId: id,
    name: 'The Old Mill',
    slug: 'the-old-mill',
    logoId: null,
    coverImageId: null,
    description: null,
    cuisineType: null,
    averageRating: null,
    priceLevel: null,
    status: 'Active',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

function branch(id: string, ownerRestaurantId: string): BranchResult {
  return {
    branchId: id,
    restaurantId: ownerRestaurantId,
    city: 'Damascus',
    district: null,
    address: '123 Main St',
    latitude: null,
    longitude: null,
    countryCode: 'SY',
    currency: null,
    timezone: 'Asia/Damascus',
    phone: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

describe('ListDiscoverableBranchesUseCase', () => {
  it("lists only this restaurant's own branches", async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [restaurant(restaurantId), restaurant(otherRestaurantId)];
    reader.branches = [
      branch('22222222-2222-4222-8222-222222222221', restaurantId),
      branch('22222222-2222-4222-8222-222222222222', otherRestaurantId),
    ];

    const useCase = new ListDiscoverableBranchesUseCase(reader);
    const result = await useCase.execute({ restaurantId, page: 1, limit: 20 });

    expect(result.total).toBe(1);
    expect(result.items[0].restaurantId).toBe(restaurantId);
  });

  it('404s when the parent restaurant does not exist/is not discoverable', async () => {
    const reader = new FakeDiscoveryReader();
    const useCase = new ListDiscoverableBranchesUseCase(reader);
    await expect(useCase.execute({ restaurantId, page: 1, limit: 20 })).rejects.toBeInstanceOf(
      RestaurantNotFoundException,
    );
  });
});
