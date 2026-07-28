import { GetDiscoverableBranchUseCase } from './get-discoverable-branch.use-case';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import { FakeDiscoveryReader } from '../../../../../test/discovery/support/fake-discovery-reader';
import { RestaurantResult } from '@modules/restaurants/application/dto/restaurant.result';
import { BranchResult } from '@modules/branches/application/dto/branch.result';

const restaurantId = '11111111-1111-4111-8111-111111111111';
const otherRestaurantId = '11111111-1111-4111-8111-111111111199';
const branchId = '22222222-2222-4222-8222-222222222221';

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
    latitude: 33.5,
    longitude: 36.2,
    countryCode: 'SY',
    currency: null,
    timezone: 'Asia/Damascus',
    phone: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

describe('GetDiscoverableBranchUseCase', () => {
  it('returns the branch when it belongs to the given restaurant', async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [restaurant(restaurantId)];
    reader.branches = [branch(branchId, restaurantId)];

    const useCase = new GetDiscoverableBranchUseCase(reader);
    const result = await useCase.execute({ restaurantId, branchId });
    expect(result.branchId).toBe(branchId);
  });

  it('404s when the branch belongs to a different restaurant (IDOR-safe)', async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [restaurant(restaurantId), restaurant(otherRestaurantId)];
    reader.branches = [branch(branchId, otherRestaurantId)];

    const useCase = new GetDiscoverableBranchUseCase(reader);
    await expect(useCase.execute({ restaurantId, branchId })).rejects.toBeInstanceOf(
      BranchNotFoundException,
    );
  });

  it('404s when the parent restaurant does not exist', async () => {
    const reader = new FakeDiscoveryReader();
    const useCase = new GetDiscoverableBranchUseCase(reader);
    await expect(useCase.execute({ restaurantId, branchId })).rejects.toBeInstanceOf(
      RestaurantNotFoundException,
    );
  });
});
