import { SearchOrganizationsUseCase } from './search-organizations.use-case';
import {
  OrganizationLookupRow,
  PlatformAdminOrganizationStatsReaderPort,
} from '../ports/platform-admin-organization-stats-reader.port';

class FakeReader implements PlatformAdminOrganizationStatsReaderPort {
  lastCall: { q: string; page: number; limit: number } | undefined;
  constructor(private readonly result: { items: OrganizationLookupRow[]; total: number }) {}
  async countByStatus() {
    return { total: 0, active: 0, suspended: 0, deleted: 0 };
  }
  async search(q: string, page: number, limit: number) {
    this.lastCall = { q, page, limit };
    return this.result;
  }
}

const ROW: OrganizationLookupRow = {
  id: 'o1',
  name: 'Acme Group',
  slug: 'acme-group',
  status: 'Active',
  deletedAt: null,
};

describe('SearchOrganizationsUseCase', () => {
  it('delegates q/page/limit to the reader and passes through items/total', async () => {
    const reader = new FakeReader({ items: [ROW], total: 1 });
    const useCase = new SearchOrganizationsUseCase(reader);

    const result = await useCase.execute({ q: 'acme', page: 1, limit: 20 });

    expect(reader.lastCall).toEqual({ q: 'acme', page: 1, limit: 20 });
    expect(result).toEqual({ items: [ROW], total: 1, page: 1, limit: 20 });
  });

  it('returns an empty page when nothing matches', async () => {
    const reader = new FakeReader({ items: [], total: 0 });
    const useCase = new SearchOrganizationsUseCase(reader);

    const result = await useCase.execute({ q: 'nonexistent', page: 1, limit: 20 });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });
});
