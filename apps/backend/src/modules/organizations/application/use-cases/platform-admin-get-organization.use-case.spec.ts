import { PlatformAdminGetOrganizationUseCase } from './platform-admin-get-organization.use-case';
import { OrganizationNotFoundException } from '../../domain/exceptions/organization-not-found.exception';
import {
  OrganizationDetailRow,
  OrganizationLookupQuery,
  PlatformAdminOrganizationStatsReaderPort,
} from '../ports/platform-admin-organization-stats-reader.port';

const DETAIL: OrganizationDetailRow = {
  id: '7a1f3d92-4c8b-4e15-9f20-6d3b8c1a5e04',
  name: 'Acme Hospitality Group',
  slug: 'acme-hospitality-group',
  status: 'Active',
  billingEmail: 'billing@acme-hospitality.com',
  restaurantCount: 4,
  memberCount: 7,
  createdAt: new Date('2026-03-18T11:02:44.318Z'),
  updatedAt: new Date('2026-08-27T08:19:51.664Z'),
  deletedAt: null,
};

class FakeReader implements PlatformAdminOrganizationStatsReaderPort {
  lastId: string | undefined;
  constructor(private readonly detail: OrganizationDetailRow | null) {}
  async countByStatus() {
    return { total: 0, active: 0, suspended: 0, deleted: 0 };
  }
  async search(_query: OrganizationLookupQuery) {
    return { items: [], total: 0 };
  }
  async findDetailById(organizationId: string) {
    this.lastId = organizationId;
    return this.detail;
  }
}

describe('PlatformAdminGetOrganizationUseCase', () => {
  it('returns the detail row including live restaurant and member counts', async () => {
    const reader = new FakeReader(DETAIL);
    const useCase = new PlatformAdminGetOrganizationUseCase(reader);

    const result = await useCase.execute({ organizationId: DETAIL.id });

    expect(reader.lastId).toBe(DETAIL.id);
    expect(result.restaurantCount).toBe(4);
    expect(result.memberCount).toBe(7);
  });

  it('returns a soft-deleted organization rather than 404-ing it', async () => {
    const deleted = { ...DETAIL, deletedAt: new Date('2026-09-10T00:00:00.000Z') };
    const useCase = new PlatformAdminGetOrganizationUseCase(new FakeReader(deleted));

    await expect(useCase.execute({ organizationId: DETAIL.id })).resolves.toMatchObject({
      deletedAt: deleted.deletedAt,
    });
  });

  it('throws OrganizationNotFoundException for an unknown id', async () => {
    const useCase = new PlatformAdminGetOrganizationUseCase(new FakeReader(null));

    await expect(useCase.execute({ organizationId: DETAIL.id })).rejects.toBeInstanceOf(
      OrganizationNotFoundException,
    );
  });
});
