import { ListDiscoverableBranchesUseCase } from './list-discoverable-branches.use-case';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { ListBranchWorkingHoursByBranchIdsUseCase } from '@modules/branches/application/use-cases/list-branch-working-hours-by-branch-ids.use-case';
import { BranchWorkingHours } from '@modules/branches/domain/entities/branch-working-hours.entity';
import { BranchId } from '@shared/domain/value-objects/identifiers.vo';
import { FakeDiscoveryReader } from '../../../../../test/discovery/support/fake-discovery-reader';
import { InMemoryBranchWorkingHoursRepository } from '../../../../../test/branches/support/in-memory-branch-working-hours.repository';
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

function buildUseCase(reader: FakeDiscoveryReader) {
  const branchWorkingHoursRepository = new InMemoryBranchWorkingHoursRepository();
  const listBranchWorkingHoursByBranchIdsUseCase = new ListBranchWorkingHoursByBranchIdsUseCase(
    branchWorkingHoursRepository,
  );
  return {
    useCase: new ListDiscoverableBranchesUseCase(reader, listBranchWorkingHoursByBranchIdsUseCase),
    branchWorkingHoursRepository,
  };
}

describe('ListDiscoverableBranchesUseCase', () => {
  it("lists only this restaurant's own branches, never a phone field", async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [restaurant(restaurantId), restaurant(otherRestaurantId)];
    reader.branches = [
      branch('22222222-2222-4222-8222-222222222221', restaurantId),
      branch('22222222-2222-4222-8222-222222222222', otherRestaurantId),
    ];

    const { useCase } = buildUseCase(reader);
    const result = await useCase.execute({ restaurantId, page: 1, limit: 20 });

    expect(result.total).toBe(1);
    expect(result.items[0].restaurantId).toBe(restaurantId);
  });

  it('404s when the parent restaurant does not exist/is not discoverable', async () => {
    const reader = new FakeDiscoveryReader();
    const { useCase } = buildUseCase(reader);
    await expect(useCase.execute({ restaurantId, page: 1, limit: 20 })).rejects.toBeInstanceOf(
      RestaurantNotFoundException,
    );
  });

  it('annotates workingHours from BranchWorkingHours, empty array when unconfigured (Public Working Hours)', async () => {
    const reader = new FakeDiscoveryReader();
    const branchId = '22222222-2222-4222-8222-222222222221';
    const otherBranchId = '22222222-2222-4222-8222-222222222222';
    reader.restaurants = [restaurant(restaurantId)];
    reader.branches = [branch(branchId, restaurantId), branch(otherBranchId, restaurantId)];

    const { useCase, branchWorkingHoursRepository } = buildUseCase(reader);
    await branchWorkingHoursRepository.replaceAllForBranch(BranchId.create(branchId), [
      BranchWorkingHours.create({
        id: '44444444-4444-4444-8444-444444444441',
        branchId,
        dayOfWeek: 5,
        openingTime: '17:00',
        closingTime: '23:00',
        breakStartTime: null,
        breakEndTime: null,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
    ]);

    const result = await useCase.execute({ restaurantId, page: 1, limit: 20 });

    const withHours = result.items.find((item) => item.branchId === branchId);
    const withoutHours = result.items.find((item) => item.branchId === otherBranchId);
    expect(withHours?.workingHours).toEqual([
      expect.objectContaining({ dayOfWeek: 5, openingTime: '17:00', closingTime: '23:00' }),
    ]);
    expect(withoutHours?.workingHours).toEqual([]);
  });
});
