import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaDiscoveryReader } from '@modules/discovery/infrastructure/persistence/prisma-discovery-reader';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

/**
 * `PrismaDiscoveryReader` deliberately queries the raw, un-tenant-scoped
 * `PrismaService` (see the reader's own doc comment) - this spec proves the
 * one behavior an e2e HTTP round trip cannot cheaply exercise: `Suspended`
 * and soft-deleted restaurants are excluded from public discovery even
 * though they still physically exist in Postgres, and cross-organization
 * listing genuinely has no tenant context bound at all (no
 * `TenantContextMissingException`, unlike every tenant-scoped repository).
 */
const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'discovery-repo-';

describe('PrismaDiscoveryReader (integration)', () => {
  let dbAvailable = false;
  let reader: PrismaDiscoveryReader;
  let orgId: string;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([PrismaDiscoveryReader]);
    reader = moduleRef.get(PrismaDiscoveryReader);

    const org = await rawPrisma.organization.create({
      data: {
        name: 'Discovery Repo Test Org',
        slug: `${TEST_PREFIX}org-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}@example.com`,
      },
    });
    orgId = org.id;
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    await rawPrisma.restaurant.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.organization.deleteMany({ where: { id: orgId } });
    await rawPrisma.$disconnect();
  });

  async function createRestaurant(overrides: {
    status?: string;
    deletedAt?: Date | null;
  }): Promise<string> {
    const restaurant = await rawPrisma.restaurant.create({
      data: {
        organizationId: orgId,
        name: 'Repo Test Restaurant',
        slug: `${TEST_PREFIX}${randomUUID()}`,
        status: overrides.status ?? 'Active',
        deletedAt: overrides.deletedAt ?? null,
      },
    });
    return restaurant.id;
  }

  it('does not throw for an unbound tenant context (genuinely public, unlike tenant-scoped repositories)', async () => {
    if (!dbAvailable) return;
    await expect(reader.listRestaurants(1, 20)).resolves.toBeDefined();
  });

  it('excludes a Suspended restaurant from both listing and get-by-id', async () => {
    if (!dbAvailable) return;
    const id = await createRestaurant({ status: 'Suspended' });

    const page = await reader.listRestaurants(1, 100);
    expect(page.items.some((item) => item.restaurantId === id)).toBe(false);

    const single = await reader.getRestaurantById(id);
    expect(single).toBeNull();
  });

  it('excludes a soft-deleted restaurant from both listing and get-by-id', async () => {
    if (!dbAvailable) return;
    const id = await createRestaurant({ deletedAt: new Date() });

    const page = await reader.listRestaurants(1, 100);
    expect(page.items.some((item) => item.restaurantId === id)).toBe(false);

    const single = await reader.getRestaurantById(id);
    expect(single).toBeNull();
  });

  it('returns an Active restaurant with no organizationId field on the result', async () => {
    if (!dbAvailable) return;
    const id = await createRestaurant({});

    const result = await reader.getRestaurantById(id);
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty('organizationId');
  });
});
