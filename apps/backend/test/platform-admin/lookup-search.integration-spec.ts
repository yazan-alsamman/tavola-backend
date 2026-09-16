import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaPlatformAdminRestaurantLookupReader } from '@modules/restaurants/infrastructure/persistence/prisma-platform-admin-restaurant-lookup.reader';
import { PrismaPlatformAdminOrganizationStatsReader } from '@modules/organizations/infrastructure/persistence/prisma-platform-admin-organization-stats.reader';
import { PrismaAcquisitionPricingRuleRepository } from '@modules/customer-acquisition/infrastructure/persistence/prisma-acquisition-pricing-rule.repository';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'lkp_int_';

/**
 * Phase 19.7 — narrow per-entity lookup/search (ADR-034 §13). Proves the
 * real ILIKE (`contains`/`mode: 'insensitive'`) queries against real
 * Postgres: exact match, partial match, case-insensitive match, and
 * no-result, for each of Restaurant/Organization/PricingRule. Every test
 * uses a `${TEST_PREFIX}` name/label so it never collides with unrelated
 * rows in a shared dev database.
 */
describe('Platform Admin narrow lookup/search (integration, real Postgres)', () => {
  let dbAvailable = false;
  let restaurantReader: PrismaPlatformAdminRestaurantLookupReader;
  let organizationReader: PrismaPlatformAdminOrganizationStatsReader;
  let pricingRuleRepository: PrismaAcquisitionPricingRuleRepository;

  const createdOrganizationIds: string[] = [];
  const createdRestaurantIds: string[] = [];
  const createdPricingRuleIds: string[] = [];

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([
      PrismaPlatformAdminRestaurantLookupReader,
      PrismaPlatformAdminOrganizationStatsReader,
      PrismaAcquisitionPricingRuleRepository,
    ]);
    restaurantReader = moduleRef.get(PrismaPlatformAdminRestaurantLookupReader);
    organizationReader = moduleRef.get(PrismaPlatformAdminOrganizationStatsReader);
    pricingRuleRepository = moduleRef.get(PrismaAcquisitionPricingRuleRepository);
  });

  afterAll(async () => {
    if (dbAvailable) {
      await rawPrisma.acquisitionPricingRule.deleteMany({
        where: { id: { in: createdPricingRuleIds } },
      });
      await rawPrisma.restaurant.deleteMany({ where: { id: { in: createdRestaurantIds } } });
      await rawPrisma.organization.deleteMany({ where: { id: { in: createdOrganizationIds } } });
      await rawPrisma.$disconnect();
    }
  });

  async function seedOrganizationAndRestaurant(name: string): Promise<{ restaurantId: string }> {
    const organizationId = randomUUID();
    await rawPrisma.organization.create({
      data: {
        id: organizationId,
        name: `${TEST_PREFIX}org_${organizationId}`,
        slug: `${TEST_PREFIX}org-${organizationId}`,
        billingEmail: `${TEST_PREFIX}${organizationId}@example.test`,
      },
    });
    createdOrganizationIds.push(organizationId);

    const restaurantId = randomUUID();
    await rawPrisma.restaurant.create({
      data: {
        id: restaurantId,
        organizationId,
        name,
        slug: `${TEST_PREFIX}rst-${restaurantId}`,
        status: 'Active',
      },
    });
    createdRestaurantIds.push(restaurantId);
    return { restaurantId };
  }

  describe('PrismaPlatformAdminRestaurantLookupReader.search', () => {
    it('matches exact, partial, and case-insensitive queries; excludes unrelated rows', async () => {
      if (!dbAvailable) return;
      const uniqueToken = randomUUID().slice(0, 8);
      const name = `${TEST_PREFIX}Golden Spoon ${uniqueToken}`;
      await seedOrganizationAndRestaurant(name);

      const exact = await restaurantReader.search({ q: name, page: 1, limit: 20 });
      expect(exact.items.map((r) => r.name)).toContain(name);

      const partial = await restaurantReader.search({
        q: `Golden Spoon ${uniqueToken}`,
        page: 1,
        limit: 20,
      });
      expect(partial.items.map((r) => r.name)).toContain(name);

      const caseInsensitive = await restaurantReader.search({
        q: `golden spoon ${uniqueToken}`.toUpperCase(),
        page: 1,
        limit: 20,
      });
      expect(caseInsensitive.items.map((r) => r.name)).toContain(name);

      const noResult = await restaurantReader.search({
        q: `${uniqueToken}-no-such-restaurant`,
        page: 1,
        limit: 20,
      });
      expect(noResult.items).toEqual([]);
      expect(noResult.total).toBe(0);
    });

    it('empty q lists restaurants (delta-safe: seeded row is present)', async () => {
      if (!dbAvailable) return;
      const uniqueToken = randomUUID().slice(0, 8);
      const name = `${TEST_PREFIX}Listed ${uniqueToken}`;
      await seedOrganizationAndRestaurant(name);

      const result = await restaurantReader.search({ q: '', page: 1, limit: 100 });
      expect(result.items.map((r) => r.name)).toContain(name);
    });

    it('whitespace-only q behaves exactly like an omitted q, against real SQL', async () => {
      if (!dbAvailable) return;
      const uniqueToken = randomUUID().slice(0, 8);
      const name = `${TEST_PREFIX}Whitespace ${uniqueToken}`;
      await seedOrganizationAndRestaurant(name);

      // `q="   "` must be treated as "no text filter", not as a search for a
      // space. Against real Postgres this is the difference between the
      // ordinary page and `LIKE '% %'`, which would drop most rows.
      const [blank, whitespace, omitted] = await Promise.all([
        restaurantReader.search({ q: '', page: 1, limit: 100 }),
        restaurantReader.search({ q: '   ', page: 1, limit: 100 }),
        restaurantReader.search({ q: '', status: undefined, page: 1, limit: 100 }),
      ]);

      expect(whitespace.items.map((r) => r.name)).toContain(name);
      expect(whitespace.total).toBe(blank.total);
      expect(whitespace.total).toBe(omitted.total);
    });

    it('status filter partitions Active/Suspended/Deleted against real rows', async () => {
      if (!dbAvailable) return;
      const uniqueToken = randomUUID().slice(0, 8);
      const activeName = `${TEST_PREFIX}StatusActive ${uniqueToken}`;
      const suspendedName = `${TEST_PREFIX}StatusSuspended ${uniqueToken}`;
      const deletedName = `${TEST_PREFIX}StatusDeleted ${uniqueToken}`;

      await seedOrganizationAndRestaurant(activeName);
      const suspended = await seedOrganizationAndRestaurant(suspendedName);
      const deleted = await seedOrganizationAndRestaurant(deletedName);

      await rawPrisma.restaurant.update({
        where: { id: suspended.restaurantId },
        data: { status: 'Suspended' },
      });
      // Deliberately Suspended AND soft-deleted, to prove the two axes are
      // distinct (ADR-034 §3): this row must surface under `Deleted` only,
      // never under `Suspended`.
      await rawPrisma.restaurant.update({
        where: { id: deleted.restaurantId },
        data: { status: 'Suspended', deletedAt: new Date() },
      });

      const [activeRows, suspendedRows, deletedRows, unfiltered] = await Promise.all([
        restaurantReader.search({ q: uniqueToken, status: 'Active', page: 1, limit: 50 }),
        restaurantReader.search({ q: uniqueToken, status: 'Suspended', page: 1, limit: 50 }),
        restaurantReader.search({ q: uniqueToken, status: 'Deleted', page: 1, limit: 50 }),
        restaurantReader.search({ q: uniqueToken, page: 1, limit: 50 }),
      ]);

      expect(activeRows.items.map((r) => r.name)).toEqual([activeName]);
      expect(suspendedRows.items.map((r) => r.name)).toEqual([suspendedName]);
      expect(deletedRows.items.map((r) => r.name)).toEqual([deletedName]);

      // No status filter returns all three, soft-deleted included.
      expect(unfiltered.items.map((r) => r.name).sort()).toEqual(
        [activeName, suspendedName, deletedName].sort(),
      );

      // `total` must describe the same predicate as the rows it accompanies.
      expect(activeRows.total).toBe(1);
      expect(suspendedRows.total).toBe(1);
      expect(deletedRows.total).toBe(1);
      expect(unfiltered.total).toBe(3);
    });
  });

  describe('PrismaPlatformAdminOrganizationStatsReader.search', () => {
    it('matches exact, partial, and case-insensitive queries; returns empty for no match', async () => {
      if (!dbAvailable) return;
      const uniqueToken = randomUUID().slice(0, 8);
      const name = `${TEST_PREFIX}Blue Harbor Group ${uniqueToken}`;
      const organizationId = randomUUID();
      await rawPrisma.organization.create({
        data: {
          id: organizationId,
          name,
          slug: `${TEST_PREFIX}org-${organizationId}`,
          billingEmail: `${TEST_PREFIX}${organizationId}@example.test`,
        },
      });
      createdOrganizationIds.push(organizationId);

      const exact = await organizationReader.search({ q: name, page: 1, limit: 20 });
      expect(exact.items.map((o) => o.name)).toContain(name);

      // Must be a genuine substring of the seeded name. The original
      // `Blue Harbor ${uniqueToken}` never was — the seeded name is
      // `<prefix>Blue Harbor Group <token>`, so the "Group " between them
      // meant this partial could not match. It went unnoticed because the
      // suite previously died on a connection error before reaching here.
      const partial = await organizationReader.search({
        q: `Harbor Group ${uniqueToken}`,
        page: 1,
        limit: 20,
      });
      expect(partial.items.map((o) => o.name)).toContain(name);

      const caseInsensitive = await organizationReader.search({
        q: `blue harbor group ${uniqueToken}`.toUpperCase(),
        page: 1,
        limit: 20,
      });
      expect(caseInsensitive.items.map((o) => o.name)).toContain(name);

      const noResult = await organizationReader.search({
        q: `${uniqueToken}-no-such-org`,
        page: 1,
        limit: 20,
      });
      expect(noResult.items).toEqual([]);
    });
  });

  describe('PrismaAcquisitionPricingRuleRepository.findMany with label/id filters', () => {
    async function seedRule(label: string): Promise<string> {
      const id = randomUUID();
      await rawPrisma.acquisitionPricingRule.create({
        data: {
          id,
          scopeType: 'Platform',
          feeType: 'Flat',
          flatAmount: 1234,
          flatCurrency: 'SYP',
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          label,
          createdBy: randomUUID(),
        },
      });
      createdPricingRuleIds.push(id);
      return id;
    }

    it('label filter matches exact/partial/case-insensitive; id filter is exact', async () => {
      if (!dbAvailable) return;
      const uniqueToken = randomUUID().slice(0, 8);
      const label = `${TEST_PREFIX}Summer Campaign ${uniqueToken}`;
      const id = await seedRule(label);

      const exact = await pricingRuleRepository.findMany(1, 20, { label });
      expect(exact.items.map((r) => r.toProps().label)).toContain(label);

      const partial = await pricingRuleRepository.findMany(1, 20, {
        label: `Summer Campaign ${uniqueToken}`,
      });
      expect(partial.items.map((r) => r.toProps().label)).toContain(label);

      const caseInsensitive = await pricingRuleRepository.findMany(1, 20, {
        label: `summer campaign ${uniqueToken}`.toUpperCase(),
      });
      expect(caseInsensitive.items.map((r) => r.toProps().label)).toContain(label);

      const byId = await pricingRuleRepository.findMany(1, 20, { id });
      expect(byId.items.map((r) => r.id)).toEqual([id]);
      expect(byId.total).toBe(1);

      const noResult = await pricingRuleRepository.findMany(1, 20, {
        label: `${uniqueToken}-no-such-rule`,
      });
      expect(noResult.items).toEqual([]);
    });
  });
});
