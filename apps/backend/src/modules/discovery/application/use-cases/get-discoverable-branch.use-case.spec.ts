import { GetDiscoverableBranchUseCase } from './get-discoverable-branch.use-case';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import { ListBranchWorkingHoursByBranchIdsUseCase } from '@modules/branches/application/use-cases/list-branch-working-hours-by-branch-ids.use-case';
import { BranchWorkingHours } from '@modules/branches/domain/entities/branch-working-hours.entity';
import { BranchId } from '@shared/domain/value-objects/identifiers.vo';
import { FakeDiscoveryReader } from '../../../../../test/discovery/support/fake-discovery-reader';
import { InMemoryBranchWorkingHoursRepository } from '../../../../../test/branches/support/in-memory-branch-working-hours.repository';
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

function buildUseCase(reader: FakeDiscoveryReader) {
  const branchWorkingHoursRepository = new InMemoryBranchWorkingHoursRepository();
  const listBranchWorkingHoursByBranchIdsUseCase = new ListBranchWorkingHoursByBranchIdsUseCase(
    branchWorkingHoursRepository,
  );
  return {
    useCase: new GetDiscoverableBranchUseCase(reader, listBranchWorkingHoursByBranchIdsUseCase),
    branchWorkingHoursRepository,
  };
}

describe('GetDiscoverableBranchUseCase', () => {
  it('returns the branch when it belongs to the given restaurant, never a phone field', async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [restaurant(restaurantId)];
    reader.branches = [branch(branchId, restaurantId)];

    const { useCase } = buildUseCase(reader);
    const result = await useCase.execute({ restaurantId, branchId });
    expect(result.branchId).toBe(branchId);
  });

  it('404s when the branch belongs to a different restaurant (IDOR-safe)', async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [restaurant(restaurantId), restaurant(otherRestaurantId)];
    reader.branches = [branch(branchId, otherRestaurantId)];

    const { useCase } = buildUseCase(reader);
    await expect(useCase.execute({ restaurantId, branchId })).rejects.toBeInstanceOf(
      BranchNotFoundException,
    );
  });

  it('404s when the parent restaurant does not exist', async () => {
    const reader = new FakeDiscoveryReader();
    const { useCase } = buildUseCase(reader);
    await expect(useCase.execute({ restaurantId, branchId })).rejects.toBeInstanceOf(
      RestaurantNotFoundException,
    );
  });

  it("includes workingHours from this branch's own override schedule (Public Working Hours)", async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [restaurant(restaurantId)];
    reader.branches = [branch(branchId, restaurantId)];

    const { useCase, branchWorkingHoursRepository } = buildUseCase(reader);
    await branchWorkingHoursRepository.replaceAllForBranch(BranchId.create(branchId), [
      BranchWorkingHours.create({
        id: '44444444-4444-4444-8444-444444444441',
        branchId,
        dayOfWeek: 0,
        openingTime: '10:00',
        closingTime: '18:00',
        breakStartTime: '13:00',
        breakEndTime: '14:00',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
    ]);

    const result = await useCase.execute({ restaurantId, branchId });
    expect(result.workingHours).toEqual([
      {
        dayOfWeek: 0,
        openingTime: '10:00',
        closingTime: '18:00',
        breakStartTime: '13:00',
        breakEndTime: '14:00',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    ]);
  });

  it('defaults workingHours to an empty array when no override is configured', async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [restaurant(restaurantId)];
    reader.branches = [branch(branchId, restaurantId)];

    const { useCase } = buildUseCase(reader);
    const result = await useCase.execute({ restaurantId, branchId });
    expect(result.workingHours).toEqual([]);
  });
});
