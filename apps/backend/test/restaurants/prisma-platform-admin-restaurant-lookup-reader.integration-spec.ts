import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { TestingModule } from '@nestjs/testing';
import { PrismaPlatformAdminRestaurantLookupReader } from '@modules/restaurants/infrastructure/persistence/prisma-platform-admin-restaurant-lookup.reader';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { seedOwnerAndOrganization, hashTestPassword } from '../helpers/owner-fixture';

const prisma = new PrismaClient();
const TEST_PREFIX = 'pa_restaurant_lookup_it_';

/**
 * ADR-035 Pattern 2 — proves this reader deliberately reads ACROSS tenants
 * with no bound TenantContext at all (the opposite property of every
 * DIRECT_TENANT_OWNED_MODELS-scoped repository, which fails closed without
 * one). This is the precondition every PlatformAdmin Restaurant lifecycle
 * use case depends on to resolve `restaurantId -> organizationId` before it
 * can Explicit-Tenant-Rebind (Pattern 1).
 */
describe('PrismaPlatformAdminRestaurantLookupReader (integration)', () => {
  let moduleRef: TestingModule | undefined;
  let reader: PrismaPlatformAdminRestaurantLookupReader;
  let dbAvailable = false;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — lookup reader integration tests NOT EXECUTED.');
      return;
    }
    moduleRef = await createPrismaIntegrationModule([PrismaPlatformAdminRestaurantLookupReader]);
    reader = moduleRef.get(PrismaPlatformAdminRestaurantLookupReader);
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.restaurant.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
      await prisma.subscriptionUsage.deleteMany({
        where: { organization: { name: { startsWith: TEST_PREFIX } } },
      });
      await prisma.subscription.deleteMany({
        where: { organization: { name: { startsWith: TEST_PREFIX } } },
      });
      await prisma.organizationMember.deleteMany({
        where: { organization: { name: { startsWith: TEST_PREFIX } } },
      });
      await prisma.organization.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
      await prisma.$disconnect();
    }
    if (moduleRef) {
      await moduleRef.close();
    }
  });

  it('resolves organizationId for a Restaurant belonging to an ARBITRARY Organization, with no tenant context bound (Pattern 2, cross-tenant by design)', async () => {
    if (!dbAvailable) return;

    const passwordHash = await hashTestPassword('SecurePass123!');
    const { organizationId } = await seedOwnerAndOrganization(prisma, {
      email: `${TEST_PREFIX}owner-${randomUUID()}@example.com`,
      passwordHash,
      organizationName: `${TEST_PREFIX}Org ${randomUUID()}`,
    });
    const restaurantId = randomUUID();
    await prisma.restaurant.create({
      data: {
        id: restaurantId,
        organizationId,
        name: `${TEST_PREFIX}Restaurant`,
        slug: `${TEST_PREFIX}restaurant-${randomUUID()}`,
        status: 'Active',
      },
    });

    // No TenantContextPort.runAsync wrapping this call at all - proves the
    // read genuinely requires no bound tenant identity, unlike every
    // DIRECT_TENANT_OWNED_MODELS-scoped repository.
    const result = await reader.findOrganizationIdByRestaurantId(restaurantId);

    expect(result).toEqual({ restaurantId, organizationId });
  });

  it('returns null for an unknown restaurant id (no leak, no throw)', async () => {
    if (!dbAvailable) return;

    const result = await reader.findOrganizationIdByRestaurantId(randomUUID());

    expect(result).toBeNull();
  });

  it('resolves a soft-deleted Restaurant too (Restore needs to see it)', async () => {
    if (!dbAvailable) return;

    const passwordHash = await hashTestPassword('SecurePass123!');
    const { organizationId } = await seedOwnerAndOrganization(prisma, {
      email: `${TEST_PREFIX}owner-deleted-${randomUUID()}@example.com`,
      passwordHash,
      organizationName: `${TEST_PREFIX}Org Deleted ${randomUUID()}`,
    });
    const restaurantId = randomUUID();
    await prisma.restaurant.create({
      data: {
        id: restaurantId,
        organizationId,
        name: `${TEST_PREFIX}Deleted Restaurant`,
        slug: `${TEST_PREFIX}deleted-restaurant-${randomUUID()}`,
        status: 'Active',
        deletedAt: new Date(),
      },
    });

    const result = await reader.findOrganizationIdByRestaurantId(restaurantId);

    expect(result).toEqual({ restaurantId, organizationId });
  });
});
