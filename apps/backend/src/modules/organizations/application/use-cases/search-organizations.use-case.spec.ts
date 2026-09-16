import { SearchOrganizationsUseCase } from './search-organizations.use-case';
import {
  OrganizationDetailRow,
  OrganizationLookupQuery,
  OrganizationLookupRow,
  PlatformAdminOrganizationStatsReaderPort,
} from '../ports/platform-admin-organization-stats-reader.port';

class FakeReader implements PlatformAdminOrganizationStatsReaderPort {
  lastCall: OrganizationLookupQuery | undefined;
  constructor(private readonly result: { items: OrganizationLookupRow[]; total: number }) {}
  async countByStatus() {
    return { total: 0, active: 0, suspended: 0, deleted: 0 };
  }
  async search(query: OrganizationLookupQuery) {
    this.lastCall = query;
    return this.result;
  }
  async findDetailById(): Promise<OrganizationDetailRow | null> {
    return null;
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

    expect(reader.lastCall).toEqual({ q: 'acme', status: undefined, page: 1, limit: 20 });
    expect(result).toEqual({ items: [ROW], total: 1, page: 1, limit: 20 });
  });

  it('returns an empty page when nothing matches', async () => {
    const reader = new FakeReader({ items: [], total: 0 });
    const useCase = new SearchOrganizationsUseCase(reader);

    const result = await useCase.execute({ q: 'nonexistent', page: 1, limit: 20 });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('forwards the status filter when supplied', async () => {
    const reader = new FakeReader({ items: [ROW], total: 1 });
    const useCase = new SearchOrganizationsUseCase(reader);

    await useCase.execute({ q: '', status: 'Suspended', page: 2, limit: 50 });

    expect(reader.lastCall).toEqual({ q: '', status: 'Suspended', page: 2, limit: 50 });
  });

  it('passes an empty q through untouched rather than treating it as "no results"', async () => {
    // The use case must not second-guess a blank search - deciding that an
    // empty `q` means "no text filter" is the reader's job, and short-
    // circuiting here would make `q=""` return nothing.
    const reader = new FakeReader({ items: [ROW], total: 1 });
    const useCase = new SearchOrganizationsUseCase(reader);

    const result = await useCase.execute({ q: '', page: 1, limit: 20 });

    expect(reader.lastCall?.q).toBe('');
    expect(result.items).toEqual([ROW]);
  });
});
