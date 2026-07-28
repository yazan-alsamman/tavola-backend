import { GetDiscoverableFloorPlanUseCase } from './get-discoverable-floor-plan.use-case';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import { FloorPlanNotFoundException } from '@modules/tables/domain/exceptions/floor-plan-not-found.exception';
import { FakeDiscoveryReader } from '../../../../../test/discovery/support/fake-discovery-reader';
import { RestaurantResult } from '@modules/restaurants/application/dto/restaurant.result';
import { BranchResult } from '@modules/branches/application/dto/branch.result';
import { FloorPlanResult } from '@modules/tables/application/dto/floor-plan.result';
import { TableResult } from '@modules/tables/application/dto/table.result';
import { TableShape, TableStatus } from '@modules/tables/domain/enums/table.enums';

const restaurantId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222221';
const floorPlanId = '33333333-3333-4333-8333-333333333331';

function restaurant(): RestaurantResult {
  return {
    restaurantId,
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

function branch(): BranchResult {
  return {
    branchId,
    restaurantId,
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

function floorPlan(isActive: boolean): FloorPlanResult {
  return {
    floorPlanId,
    branchId,
    name: 'Main Floor',
    isActive,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

function table(id: string): TableResult {
  return {
    tableId: id,
    branchId,
    floorPlanId,
    tableNumber: 'T1',
    capacity: 4,
    floor: 1,
    positionX: 10,
    positionY: 20,
    width: 100,
    height: 100,
    rotation: 0,
    shape: TableShape.Rectangle,
    layer: 0,
    indoor: true,
    vip: false,
    smoking: false,
    status: TableStatus.Available,
    mergeGroupId: null,
    isMergePrimary: false,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

describe('GetDiscoverableFloorPlanUseCase', () => {
  it('returns the active floor plan with its table topology', async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [restaurant()];
    reader.branches = [branch()];
    reader.floorPlans = [floorPlan(true)];
    reader.tables = [table('44444444-4444-4444-8444-444444444441')];

    const useCase = new GetDiscoverableFloorPlanUseCase(reader);
    const result = await useCase.execute({ restaurantId, branchId });

    expect(result.floorPlan.floorPlanId).toBe(floorPlanId);
    expect(result.tables).toHaveLength(1);
  });

  it('404s when the branch has no active floor plan', async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [restaurant()];
    reader.branches = [branch()];
    reader.floorPlans = [floorPlan(false)];

    const useCase = new GetDiscoverableFloorPlanUseCase(reader);
    await expect(useCase.execute({ restaurantId, branchId })).rejects.toBeInstanceOf(
      FloorPlanNotFoundException,
    );
  });

  it('404s when the branch does not exist', async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [restaurant()];

    const useCase = new GetDiscoverableFloorPlanUseCase(reader);
    await expect(useCase.execute({ restaurantId, branchId })).rejects.toBeInstanceOf(
      BranchNotFoundException,
    );
  });

  it('404s when the restaurant does not exist', async () => {
    const reader = new FakeDiscoveryReader();
    const useCase = new GetDiscoverableFloorPlanUseCase(reader);
    await expect(useCase.execute({ restaurantId, branchId })).rejects.toBeInstanceOf(
      RestaurantNotFoundException,
    );
  });
});
