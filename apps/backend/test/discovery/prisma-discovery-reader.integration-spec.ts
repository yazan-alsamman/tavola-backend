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
    await expect(reader.listRestaurants({ page: 1, limit: 20 })).resolves.toBeDefined();
  });

  it('excludes a Suspended restaurant from both listing and get-by-id', async () => {
    if (!dbAvailable) return;
    const id = await createRestaurant({ status: 'Suspended' });

    const page = await reader.listRestaurants({ page: 1, limit: 100 });
    expect(page.items.some((item) => item.restaurantId === id)).toBe(false);

    const single = await reader.getRestaurantById(id);
    expect(single).toBeNull();
  });

  it('excludes a soft-deleted restaurant from both listing and get-by-id', async () => {
    if (!dbAvailable) return;
    const id = await createRestaurant({ deletedAt: new Date() });

    const page = await reader.listRestaurants({ page: 1, limit: 100 });
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

  /**
   * Phase 15.5 (Discovery Module, architecture frozen 2026-07-29, D5-D7).
   */
  describe('listRestaurants filters/sort (Phase 15.5)', () => {
    it('filters by q via ILIKE against name only, case-insensitive', async () => {
      if (!dbAvailable) return;
      const matchId = await createRestaurant({});
      await rawPrisma.restaurant.update({
        where: { id: matchId },
        data: { name: `${TEST_PREFIX}Old Mill Bistro` },
      });

      const page = await reader.listRestaurants({ page: 1, limit: 100, q: 'old mill' });
      expect(page.items.some((item) => item.restaurantId === matchId)).toBe(true);
    });

    it('filters by priceLevel exactly', async () => {
      if (!dbAvailable) return;
      const id = await createRestaurant({});
      await rawPrisma.restaurant.update({ where: { id }, data: { priceLevel: 4 } });

      const matching = await reader.listRestaurants({ page: 1, limit: 100, priceLevel: 4 });
      expect(matching.items.some((item) => item.restaurantId === id)).toBe(true);

      const nonMatching = await reader.listRestaurants({ page: 1, limit: 100, priceLevel: 1 });
      expect(nonMatching.items.some((item) => item.restaurantId === id)).toBe(false);
    });

    it('filters by minRating against the persisted averageRating, excluding NULL', async () => {
      if (!dbAvailable) return;
      const highId = await createRestaurant({});
      await rawPrisma.restaurant.update({ where: { id: highId }, data: { averageRating: 4.8 } });
      const nullId = await createRestaurant({});

      const page = await reader.listRestaurants({ page: 1, limit: 100, minRating: 4 });
      expect(page.items.some((item) => item.restaurantId === highId)).toBe(true);
      expect(page.items.some((item) => item.restaurantId === nullId)).toBe(false);
    });

    it('sorts by rating desc with NULLs last (Postgres default would otherwise put them first)', async () => {
      if (!dbAvailable) return;
      const topId = await createRestaurant({});
      await rawPrisma.restaurant.update({ where: { id: topId }, data: { averageRating: 5 } });
      const nullId = await createRestaurant({});

      const page = await reader.listRestaurants({ page: 1, limit: 100, sort: 'rating' });
      const topIndex = page.items.findIndex((item) => item.restaurantId === topId);
      const nullIndex = page.items.findIndex((item) => item.restaurantId === nullId);
      expect(topIndex).toBeGreaterThanOrEqual(0);
      expect(nullIndex).toBeGreaterThan(topIndex);
    });

    it('is deterministic under a name tie via the restaurantId secondary sort (D17)', async () => {
      if (!dbAvailable) return;
      const firstCallIds = (
        await reader.listRestaurants({ page: 1, limit: 100, sort: 'name' })
      ).items.map((item) => item.restaurantId);
      const secondCallIds = (
        await reader.listRestaurants({ page: 1, limit: 100, sort: 'name' })
      ).items.map((item) => item.restaurantId);
      expect(firstCallIds).toEqual(secondCallIds);
    });
  });

  /**
   * Phase 15.5 (Discovery Module, architecture frozen 2026-07-29, D2-D4/D13).
   * Real coordinate fixtures, proving the bounding-box + Haversine query
   * against real PostgreSQL, not just the pure-function unit tests.
   */
  describe('searchNearby (Phase 15.5)', () => {
    const DAMASCUS = { lat: 33.5138, lng: 36.2765 };
    let restaurantNearId: string;
    let restaurantFarId: string;
    let restaurantNoCoordsId: string;

    async function createBranch(
      restaurantId: string,
      lat: number | null,
      lng: number | null,
    ): Promise<string> {
      const branch = await rawPrisma.branch.create({
        data: {
          restaurantId,
          city: 'Damascus',
          address: '1 Main St',
          latitude: lat,
          longitude: lng,
          countryCode: 'SY',
          timezone: 'Asia/Damascus',
        },
      });
      return branch.id;
    }

    beforeAll(async () => {
      if (!dbAvailable) return;
      restaurantNearId = await createRestaurant({});
      restaurantFarId = await createRestaurant({});
      restaurantNoCoordsId = await createRestaurant({});
      await createBranch(restaurantNearId, DAMASCUS.lat + 0.001, DAMASCUS.lng);
      // Aleppo - ~300km away, outside every radius used below.
      await createBranch(restaurantFarId, 36.2021, 37.1343);
      await createBranch(restaurantNoCoordsId, null, null);
    });

    afterAll(async () => {
      if (!dbAvailable) return;
      await rawPrisma.branch.deleteMany({
        where: {
          restaurantId: {
            in: [restaurantNearId, restaurantFarId, restaurantNoCoordsId].filter(Boolean),
          },
        },
      });
    });

    it('includes a branch inside the radius and excludes one outside it', async () => {
      if (!dbAvailable) return;
      const page = await reader.searchNearby({
        lat: DAMASCUS.lat,
        lng: DAMASCUS.lng,
        radiusKm: 5,
        page: 1,
        limit: 100,
      });
      const ids = page.items.map((item) => item.restaurantId);
      expect(ids).toContain(restaurantNearId);
      expect(ids).not.toContain(restaurantFarId);
    });

    it('excludes a branch with NULL latitude/longitude', async () => {
      if (!dbAvailable) return;
      const page = await reader.searchNearby({
        lat: DAMASCUS.lat,
        lng: DAMASCUS.lng,
        radiusKm: 50,
        page: 1,
        limit: 100,
      });
      expect(page.items.map((item) => item.restaurantId)).not.toContain(restaurantNoCoordsId);
    });

    it('computes a real, sane distanceKm for the near restaurant (well under 1km)', async () => {
      if (!dbAvailable) return;
      const page = await reader.searchNearby({
        lat: DAMASCUS.lat,
        lng: DAMASCUS.lng,
        radiusKm: 5,
        page: 1,
        limit: 100,
      });
      const near = page.items.find((item) => item.restaurantId === restaurantNearId);
      expect(near).toBeDefined();
      expect(near!.distanceKm).toBeGreaterThanOrEqual(0);
      expect(near!.distanceKm).toBeLessThan(1);
    });
  });

  describe('getRestaurantsByIds (Phase 15.5, Comparison API D18/D19)', () => {
    it('returns only the visible (Active, non-deleted) subset of the requested ids', async () => {
      if (!dbAvailable) return;
      const activeId = await createRestaurant({});
      const suspendedId = await createRestaurant({ status: 'Suspended' });

      const results = await reader.getRestaurantsByIds([activeId, suspendedId, randomUUID()]);
      expect(results.map((r) => r.restaurantId)).toEqual([activeId]);
    });

    it('returns an empty array for an empty input without querying the database', async () => {
      if (!dbAvailable) return;
      const results = await reader.getRestaurantsByIds([]);
      expect(results).toEqual([]);
    });
  });
});
