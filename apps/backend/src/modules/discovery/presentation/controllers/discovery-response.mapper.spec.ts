import { RestaurantResult } from '@modules/restaurants/application/dto/restaurant.result';
import { WorkingHoursEntryResult } from '@modules/restaurants/application/dto/working-hours.result';
import { BranchResult } from '@modules/branches/application/dto/branch.result';
import { BranchWorkingHoursEntryResult } from '@modules/branches/application/dto/branch-working-hours.result';
import {
  toDiscoveryBranchResponse,
  toDiscoveryRestaurantResponse,
} from './discovery-response.mapper';

function restaurant(overrides: Partial<RestaurantResult> = {}): RestaurantResult {
  return {
    restaurantId: '11111111-1111-4111-8111-111111111111',
    name: 'The Old Mill',
    slug: 'the-old-mill',
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

function branch(overrides: Partial<BranchResult> = {}): BranchResult {
  return {
    branchId: '22222222-2222-4222-8222-222222222221',
    restaurantId: '11111111-1111-4111-8111-111111111111',
    city: 'Damascus',
    district: null,
    address: '123 Main St',
    latitude: null,
    longitude: null,
    countryCode: 'SY',
    currency: null,
    timezone: 'Asia/Damascus',
    phone: '+963900000000',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

const workingHoursEntry: WorkingHoursEntryResult = {
  dayOfWeek: 1,
  openingTime: '09:00',
  closingTime: '17:00',
  breakStartTime: null,
  breakEndTime: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
};

const branchWorkingHoursEntry: BranchWorkingHoursEntryResult = {
  dayOfWeek: 2,
  openingTime: '10:00',
  closingTime: '22:00',
  breakStartTime: '13:00',
  breakEndTime: '14:00',
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
};

describe('discovery-response.mapper', () => {
  describe('toDiscoveryRestaurantResponse', () => {
    it('maps workingHours entries, dropping createdAt/updatedAt (customer-safe projection)', () => {
      const response = toDiscoveryRestaurantResponse({
        ...restaurant(),
        workingHours: [workingHoursEntry],
      });

      expect(response.workingHours).toEqual([
        {
          dayOfWeek: 1,
          openingTime: '09:00',
          closingTime: '17:00',
          breakStartTime: null,
          breakEndTime: null,
        },
      ]);
      expect(response.workingHours[0]).not.toHaveProperty('createdAt');
      expect(response.workingHours[0]).not.toHaveProperty('updatedAt');
    });

    it('defaults to an empty workingHours array', () => {
      const response = toDiscoveryRestaurantResponse({ ...restaurant(), workingHours: [] });
      expect(response.workingHours).toEqual([]);
    });
  });

  describe('toDiscoveryBranchResponse', () => {
    it('never copies phone into the response object (structural omission, not just a TS type)', () => {
      const response = toDiscoveryBranchResponse({ ...branch(), workingHours: [] });

      expect(response).not.toHaveProperty('phone');
      expect(Object.keys(response)).not.toContain('phone');
      expect(JSON.stringify(response)).not.toContain('963900000000');
    });

    it('maps workingHours entries for the branch override schedule', () => {
      const response = toDiscoveryBranchResponse({
        ...branch(),
        workingHours: [branchWorkingHoursEntry],
      });

      expect(response.workingHours).toEqual([
        {
          dayOfWeek: 2,
          openingTime: '10:00',
          closingTime: '22:00',
          breakStartTime: '13:00',
          breakEndTime: '14:00',
        },
      ]);
    });
  });
});
