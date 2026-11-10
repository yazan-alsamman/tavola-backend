import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaMenuPriceLevelRepository } from '@modules/menus/infrastructure/persistence/prisma-menu-price-level.repository';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'menu-price-level-';

/**
 * ADR-046 - the price-level recompute against real PostgreSQL. The branches
 * use a currency no other row uses, so their quartiles are theirs alone.
 */
describe('PrismaMenuPriceLevelRepository (integration)', () => {
  let dbAvailable = false;
  let repository: PrismaMenuPriceLevelRepository;
  let organizationId: string;
  let restaurantId: string;
  const currency = `Q${randomUUID()
    .replace(/[^A-Z]/gi, '')
    .slice(0, 2)
    .toUpperCase()
    .padEnd(2, 'Z')}`;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }
    const moduleRef = await createPrismaIntegrationModule([PrismaMenuPriceLevelRepository]);
    repository = moduleRef.get(PrismaMenuPriceLevelRepository);

    const org = await rawPrisma.organization.create({
      data: {
        name: 'Price Level Test Org',
        slug: `${TEST_PREFIX}org-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}@example.com`,
      },
    });
    organizationId = org.id;
    const restaurant = await rawPrisma.restaurant.create({
      data: {
        organizationId,
        name: 'Price Level Test Restaurant',
        slug: `${TEST_PREFIX}restaurant-${randomUUID()}`,
        status: 'Active',
        priceLevel: 1,
      },
    });
    restaurantId = restaurant.id;
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    await rawPrisma.restaurant.deleteMany({ where: { id: restaurantId } });
    await rawPrisma.organization.deleteMany({ where: { id: organizationId } });
    await rawPrisma.$disconnect();
  });

  async function branch(): Promise<string> {
    const row = await rawPrisma.branch.create({
      data: {
        restaurantId,
        city: 'Damascus',
        address: 'Test St',
        countryCode: 'SY',
        currency,
        timezone: 'Asia/Damascus',
      },
    });
    return row.id;
  }

  async function menu(prices: number[], branchId: string | null): Promise<void> {
    const created = await rawPrisma.menu.create({
      data: { restaurantId, branchId, name: 'Test', isDefault: true },
    });
    const category = await rawPrisma.menuCategory.create({
      data: { menuId: created.id, restaurantId, name: 'All' },
    });
    await rawPrisma.menuItem.createMany({
      data: prices.map((price, index) => ({
        categoryId: category.id,
        restaurantId,
        name: `Item ${index}`,
        price,
      })),
    });
  }

  async function read(branchId: string) {
    const row = await rawPrisma.branch.findUniqueOrThrow({ where: { id: branchId } });
    return {
      referencePrice: row.referencePrice === null ? null : row.referencePrice.toNumber(),
      priceLevel: row.priceLevel,
    };
  }

  it('ranks branches by the average of items 2 to 11, with the shared menu as fallback', async () => {
    if (!dbAvailable) return;

    const cheap = await branch();
    const fallback = await branch();
    const mid = await branch();
    const dear = await branch();
    const tooSmall = await branch();

    await menu([100, 20, 20], null);
    await menu([500, 10, 10], cheap);
    await menu([500, 30, 30], mid);
    await menu([500, 40], dear);
    await menu([99], tooSmall);

    const updated = await repository.recomputeAll();

    expect(updated).toBeGreaterThanOrEqual(4);
    expect(await read(cheap)).toEqual({ referencePrice: 10, priceLevel: 1 });
    expect(await read(fallback)).toEqual({ referencePrice: 20, priceLevel: 2 });
    expect(await read(mid)).toEqual({ referencePrice: 30, priceLevel: 3 });
    expect(await read(dear)).toEqual({ referencePrice: 40, priceLevel: 4 });
    expect(await read(tooSmall)).toEqual({ referencePrice: null, priceLevel: null });

    // Restaurant level: ROUND(AVG(1, 2, 3, 4)) = ROUND(2.5) = 3.
    const restaurant = await rawPrisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
    });
    expect(restaurant.priceLevel).toBe(3);

    // A second run with nothing changed writes nothing for these branches.
    await repository.recomputeAll();
    expect(await read(mid)).toEqual({ referencePrice: 30, priceLevel: 3 });
  });
});
