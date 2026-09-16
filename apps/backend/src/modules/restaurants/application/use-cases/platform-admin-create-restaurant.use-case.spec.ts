import { PlatformAdminCreateRestaurantUseCase } from './platform-admin-create-restaurant.use-case';
import { CreateRestaurantUseCase } from './create-restaurant.use-case';
import { CreateRestaurantCommand } from '../dto/create-restaurant.command';
import { RestaurantResult } from '../dto/restaurant.result';
import { OrganizationNotFoundException } from '@modules/organizations/domain/exceptions/organization-not-found.exception';
import {
  OrganizationDetailRow,
  OrganizationLookupQuery,
  PlatformAdminOrganizationStatsReaderPort,
} from '@modules/organizations/application/ports/platform-admin-organization-stats-reader.port';
import {
  TenantBootstrapContext,
  TenantContextPort,
} from '@shared/application/ports/tenant-context.port';

const ORGANIZATION_ID = '7a1f3d92-4c8b-4e15-9f20-6d3b8c1a5e04';
const ACTOR_ID = '9f14c2a1-7b3e-4d58-9a6f-21c8e4b0d375';

const ORGANIZATION: OrganizationDetailRow = {
  id: ORGANIZATION_ID,
  name: 'Acme Hospitality Group',
  slug: 'acme-hospitality-group',
  status: 'Active',
  billingEmail: 'billing@acme-hospitality.com',
  restaurantCount: 1,
  memberCount: 2,
  createdAt: new Date('2026-03-18T11:02:44.318Z'),
  updatedAt: new Date('2026-03-18T11:02:44.318Z'),
  deletedAt: null,
};

const CREATED: RestaurantResult = {
  restaurantId: 'c4e91b07-2a63-4f88-b5d1-3e7a9c204f16',
  name: 'The Old Mill',
  slug: 'the-old-mill',
  logoId: null,
  coverImageId: null,
  description: null,
  cuisineType: null,
  averageRating: null,
  priceLevel: null,
  status: 'Active',
  createdAt: new Date('2026-09-15T10:00:00.000Z'),
  updatedAt: new Date('2026-09-15T10:00:00.000Z'),
};

class FakeOrganizationReader implements PlatformAdminOrganizationStatsReaderPort {
  constructor(private readonly detail: OrganizationDetailRow | null) {}
  async countByStatus() {
    return { total: 0, active: 0, suspended: 0, deleted: 0 };
  }
  async search(_query: OrganizationLookupQuery) {
    return { items: [], total: 0 };
  }
  async findDetailById() {
    return this.detail;
  }
}

class RecordingTenantContext implements TenantContextPort {
  contexts: TenantBootstrapContext[] = [];
  async runAsync<T>(context: TenantBootstrapContext, work: () => Promise<T>): Promise<T> {
    this.contexts.push(context);
    return work();
  }
}

describe('PlatformAdminCreateRestaurantUseCase', () => {
  function build(organization: OrganizationDetailRow | null = ORGANIZATION) {
    const execute = jest.fn<Promise<RestaurantResult>, [CreateRestaurantCommand]>();
    execute.mockResolvedValue(CREATED);
    const inner = { execute } as unknown as CreateRestaurantUseCase;
    const tenantContext = new RecordingTenantContext();
    const useCase = new PlatformAdminCreateRestaurantUseCase(
      inner,
      new FakeOrganizationReader(organization),
      tenantContext,
    );
    return { useCase, execute, tenantContext };
  }

  const command = {
    organizationId: ORGANIZATION_ID,
    name: 'The Old Mill',
    description: null,
    cuisineType: null,
    priceLevel: null,
    actorId: ACTOR_ID,
  };

  it('rebinds to the target organization before delegating', async () => {
    const { useCase, tenantContext } = build();

    await useCase.execute(command);

    // ADR-035 Pattern 1: without this the inner use case's tenant-scoped
    // repositories would have no bound organization at all, since no
    // TenantContextInterceptor ran for a Platform Admin request.
    expect(tenantContext.contexts).toHaveLength(1);
    expect(tenantContext.contexts[0]).toMatchObject({
      organizationId: ORGANIZATION_ID,
      userId: null,
      actorType: 'PlatformAdmin',
    });
  });

  it('delegates to CreateRestaurantUseCase rather than reimplementing creation', async () => {
    const { useCase, execute } = build();

    const result = await useCase.execute({ ...command, slug: 'custom', priceLevel: 3 });

    // Reuse is what guarantees the RestaurantSettings/RestaurantUsage rows
    // and the subscription limit check happen on this path too.
    expect(execute).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      actorId: ACTOR_ID,
      name: 'The Old Mill',
      slug: 'custom',
      description: null,
      cuisineType: null,
      priceLevel: 3,
      correlationId: undefined,
    });
    expect(result).toEqual(CREATED);
  });

  it('rejects an unknown organization before attempting creation', async () => {
    const { useCase, execute } = build(null);

    await expect(useCase.execute(command)).rejects.toBeInstanceOf(OrganizationNotFoundException);
    // A clear 404, rather than letting this surface two layers down as a
    // confusing "subscription not found".
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects a soft-deleted organization', async () => {
    // A Restaurant created inside a deleted Organization would be
    // immediately unreachable.
    const { useCase, execute } = build({ ...ORGANIZATION, deletedAt: new Date() });

    await expect(useCase.execute(command)).rejects.toBeInstanceOf(OrganizationNotFoundException);
    expect(execute).not.toHaveBeenCalled();
  });

  it('propagates the inner use case failure unchanged', async () => {
    // Subscription-limit and slug-conflict errors must reach the caller as
    // themselves - a Platform Owner does not silently bypass plan limits.
    const { useCase, execute } = build();
    const limitError = new Error('ORGANIZATION_LIMIT_EXCEEDED');
    execute.mockRejectedValue(limitError);

    await expect(useCase.execute(command)).rejects.toBe(limitError);
  });
});
