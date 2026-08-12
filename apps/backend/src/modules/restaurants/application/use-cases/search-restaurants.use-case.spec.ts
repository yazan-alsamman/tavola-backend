import { SearchRestaurantsUseCase } from './search-restaurants.use-case';
import {
  PlatformAdminRestaurantLookupReaderPort,
  RestaurantLookupRow,
} from '../ports/platform-admin-restaurant-lookup-reader.port';

class FakeReader implements PlatformAdminRestaurantLookupReaderPort {
  lastCall: { q: string; page: number; limit: number } | undefined;
  constructor(private readonly result: { items: RestaurantLookupRow[]; total: number }) {}
  async findOrganizationIdByRestaurantId() {
    return null;
  }
  async countByStatus() {
    return { total: 0, active: 0, suspended: 0, deleted: 0 };
  }
  async search(q: string, page: number, limit: number) {
    this.lastCall = { q, page, limit };
    return this.result;
  }
}

const ROW: RestaurantLookupRow = {
  id: 'r1',
  organizationId: 'o1',
  name: 'Pizza Place',
  slug: 'pizza-place',
  status: 'Active',
  deletedAt: null,
};

describe('SearchRestaurantsUseCase', () => {
  it('delegates q/page/limit to the reader and passes through items/total', async () => {
    const reader = new FakeReader({ items: [ROW], total: 1 });
    const useCase = new SearchRestaurantsUseCase(reader);

    const result = await useCase.execute({ q: 'pizza', page: 2, limit: 10 });

    expect(reader.lastCall).toEqual({ q: 'pizza', page: 2, limit: 10 });
    expect(result).toEqual({ items: [ROW], total: 1, page: 2, limit: 10 });
  });

  it('returns an empty page when nothing matches', async () => {
    const reader = new FakeReader({ items: [], total: 0 });
    const useCase = new SearchRestaurantsUseCase(reader);

    const result = await useCase.execute({ q: 'nonexistent', page: 1, limit: 20 });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });
});
