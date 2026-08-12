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

      const exact = await restaurantReader.search(name, 1, 20);
      expect(exact.items.map((r) => r.name)).toContain(name);

      const partial = await restaurantReader.search(`Golden Spoon ${uniqueToken}`, 1, 20);
      expect(partial.items.map((r) => r.name)).toContain(name);

      const caseInsensitive = await restaurantReader.search(
        `golden spoon ${uniqueToken}`.toUpperCase(),
        1,
        20,
      );
      expect(caseInsensitive.items.map((r) => r.name)).toContain(name);

      const noResult = await restaurantReader.search(`${uniqueToken}-no-such-restaurant`, 1, 20);
      expect(noResult.items).toEqual([]);
      expect(noResult.total).toBe(0);
    });

    it('empty q lists restaurants (delta-safe: seeded row is present)', async () => {
      if (!dbAvailable) return;
      const uniqueToken = randomUUID().slice(0, 8);
      const name = `${TEST_PREFIX}Listed ${uniqueToken}`;
      await seedOrganizationAndRestaurant(name);

      const result = await restaurantReader.search('', 1, 100);
      expect(result.items.map((r) => r.name)).toContain(name);
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

      const exact = await organizationReader.search(name, 1, 20);
      expect(exact.items.map((o) => o.name)).toContain(name);

      const partial = await organizationReader.search(`Blue Harbor ${uniqueToken}`, 1, 20);
      expect(partial.items.map((o) => o.name)).toContain(name);

      const caseInsensitive = await organizationReader.search(
        `blue harbor group ${uniqueToken}`.toUpperCase(),
        1,
        20,
      );
      expect(caseInsensitive.items.map((o) => o.name)).toContain(name);

      const noResult = await organizationReader.search(`${uniqueToken}-no-such-org`, 1, 20);
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
