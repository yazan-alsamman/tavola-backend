import { PlatformAdminGetRestaurantUseCase } from './platform-admin-get-restaurant.use-case';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import {
  PlatformAdminRestaurantLookupReaderPort,
  RestaurantDetailRow,
  RestaurantLookupQuery,
} from '../ports/platform-admin-restaurant-lookup-reader.port';

const DETAIL: RestaurantDetailRow = {
  id: 'c4e91b07-2a63-4f88-b5d1-3e7a9c204f16',
  organizationId: '7a1f3d92-4c8b-4e15-9f20-6d3b8c1a5e04',
  organizationName: 'Acme Hospitality Group',
  organizationSlug: 'acme-hospitality-group',
  organizationStatus: 'Active',
  name: 'The Old Mill',
  slug: 'the-old-mill',
  description: 'A cozy neighborhood restaurant.',
  cuisineType: 'Italian',
  priceLevel: 2,
  averageRating: 4.35,
  logoId: null,
  coverImageId: null,
  status: 'Active',
  branchCount: 3,
  createdAt: new Date('2026-05-02T09:14:22.101Z'),
  updatedAt: new Date('2026-09-01T16:40:05.882Z'),
  deletedAt: null,
};

class FakeReader implements PlatformAdminRestaurantLookupReaderPort {
  lastId: string | undefined;
  constructor(private readonly detail: RestaurantDetailRow | null) {}
  async findOrganizationIdByRestaurantId() {
    return null;
  }
  async countByStatus() {
    return { total: 0, active: 0, suspended: 0, deleted: 0 };
  }
  async search(_query: RestaurantLookupQuery) {
    return { items: [], total: 0 };
  }
  async findDetailById(restaurantId: string) {
    this.lastId = restaurantId;
    return this.detail;
  }
}

describe('PlatformAdminGetRestaurantUseCase', () => {
  it('returns the detail row including the owning organization and branch count', async () => {
    const reader = new FakeReader(DETAIL);
    const useCase = new PlatformAdminGetRestaurantUseCase(reader);

    const result = await useCase.execute({ restaurantId: DETAIL.id });

    expect(reader.lastId).toBe(DETAIL.id);
    expect(result.organizationName).toBe('Acme Hospitality Group');
    expect(result.branchCount).toBe(3);
  });

  it('returns a soft-deleted restaurant rather than 404-ing it', async () => {
    // Restore has to be able to inspect one first, so absence of the row is
    // the only thing that counts as "not found".
    const deleted = { ...DETAIL, deletedAt: new Date('2026-09-10T00:00:00.000Z') };
    const useCase = new PlatformAdminGetRestaurantUseCase(new FakeReader(deleted));

    await expect(useCase.execute({ restaurantId: DETAIL.id })).resolves.toMatchObject({
      deletedAt: deleted.deletedAt,
    });
  });

  it('throws RestaurantNotFoundException for an unknown id', async () => {
    const useCase = new PlatformAdminGetRestaurantUseCase(new FakeReader(null));

    await expect(useCase.execute({ restaurantId: DETAIL.id })).rejects.toBeInstanceOf(
      RestaurantNotFoundException,
    );
  });
});
