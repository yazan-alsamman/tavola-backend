import { SearchRestaurantsUseCase } from './search-restaurants.use-case';
import {
  PlatformAdminRestaurantLookupReaderPort,
  RestaurantDetailRow,
  RestaurantLookupQuery,
  RestaurantLookupRow,
} from '../ports/platform-admin-restaurant-lookup-reader.port';

class FakeReader implements PlatformAdminRestaurantLookupReaderPort {
  lastCall: RestaurantLookupQuery | undefined;
  constructor(private readonly result: { items: RestaurantLookupRow[]; total: number }) {}
  async findOrganizationIdByRestaurantId() {
    return null;
  }
  async countByStatus() {
    return { total: 0, active: 0, suspended: 0, deleted: 0 };
  }
  async search(query: RestaurantLookupQuery) {
    this.lastCall = query;
    return this.result;
  }
  async findDetailById(): Promise<RestaurantDetailRow | null> {
    return null;
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

    expect(reader.lastCall).toEqual({ q: 'pizza', status: undefined, page: 2, limit: 10 });
    expect(result).toEqual({ items: [ROW], total: 1, page: 2, limit: 10 });
  });

  it('returns an empty page when nothing matches', async () => {
    const reader = new FakeReader({ items: [], total: 0 });
    const useCase = new SearchRestaurantsUseCase(reader);

    const result = await useCase.execute({ q: 'nonexistent', page: 1, limit: 20 });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('forwards the status filter when supplied', async () => {
    const reader = new FakeReader({ items: [ROW], total: 1 });
    const useCase = new SearchRestaurantsUseCase(reader);

    await useCase.execute({ q: '', status: 'Deleted', page: 1, limit: 20 });

    expect(reader.lastCall).toEqual({ q: '', status: 'Deleted', page: 1, limit: 20 });
  });

  it('passes an empty q through untouched rather than treating it as "no results"', async () => {
    // Deciding that a blank `q` means "no text filter" belongs to the reader.
    // Short-circuiting here would make `q=""` return nothing, which is the
    // exact behaviour a Platform Owner console must not see on first load.
    const reader = new FakeReader({ items: [ROW], total: 1 });
    const useCase = new SearchRestaurantsUseCase(reader);

    const result = await useCase.execute({ q: '', page: 1, limit: 20 });

    expect(reader.lastCall?.q).toBe('');
    expect(result.items).toEqual([ROW]);
  });
});
