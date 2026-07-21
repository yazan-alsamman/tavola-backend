import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';
import { PrismaCuisineCategoryRepository } from '@modules/restaurants/infrastructure/persistence/prisma-cuisine-category.repository';
import { PrismaRestaurantCuisineCategoryRepository } from '@modules/restaurants/infrastructure/persistence/prisma-restaurant-cuisine-category.repository';
import { RestaurantCuisineCategory } from '@modules/restaurants/domain/entities/restaurant-cuisine-category.entity';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

/**
 * `CuisineCategory` is platform-managed reference data (not tenant-owned at
 * all). `RestaurantCuisineCategory` is NOT in `withTenantScoping`'s
 * `DIRECT_TENANT_OWNED_MODELS` (see the repository's own doc comment), so -
 * like `prisma-working-hours.integration-spec.ts` - this spec deliberately
 * does NOT bind a tenant context around every call, and explicitly proves
 * the assignment repository performs no tenant filtering by itself.
 */
const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'cuisine-taxonomy-repo-';

describe('Cuisine taxonomy round-trip via Prisma repositories (integration)', () => {
  let dbAvailable = false;
  let categoryRepository: PrismaCuisineCategoryRepository;
  let assignmentRepository: PrismaRestaurantCuisineCategoryRepository;
  let org: { id: string };
  let categoryA: { id: string; slug: string };
  let categoryB: { id: string; slug: string };
  let inactiveCategory: { id: string; slug: string };

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([
      PrismaCuisineCategoryRepository,
      PrismaRestaurantCuisineCategoryRepository,
    ]);
    categoryRepository = moduleRef.get(PrismaCuisineCategoryRepository);
    assignmentRepository = moduleRef.get(PrismaRestaurantCuisineCategoryRepository);
    // TenantContextService is resolved only to prove it is NOT required for
    // these repositories to function - see the "does not require" test below.
    moduleRef.get(TenantContextService);

    org = await rawPrisma.organization.create({
      data: {
        name: 'Cuisine Taxonomy Repo Test Org',
        slug: `${TEST_PREFIX}org-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}@example.com`,
      },
    });

    categoryA = await rawPrisma.cuisineCategory.create({
      data: { slug: `${TEST_PREFIX}italian-${randomUUID()}`, name: 'Italian', sortOrder: 2 },
    });
    categoryB = await rawPrisma.cuisineCategory.create({
      data: { slug: `${TEST_PREFIX}japanese-${randomUUID()}`, name: 'Japanese', sortOrder: 1 },
    });
    inactiveCategory = await rawPrisma.cuisineCategory.create({
      data: {
        slug: `${TEST_PREFIX}retired-${randomUUID()}`,
        name: 'Retired',
        isActive: false,
        sortOrder: 3,
      },
    });
  });

  afterAll(async () => {
    if (!dbAvailable) return;

    await rawPrisma.restaurant.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.cuisineCategory.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.organization.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.$disconnect();
  });

  async function createRestaurant(): Promise<{ id: string }> {
    return rawPrisma.restaurant.create({
      data: {
        organizationId: org.id,
        name: 'The Old Mill',
        slug: `${TEST_PREFIX}${randomUUID()}`,
        status: 'Active',
      },
    });
  }

  function buildAssignment(restaurantId: string, cuisineCategoryId: string) {
    return RestaurantCuisineCategory.create({
      id: randomUUID(),
      restaurantId,
      cuisineCategoryId,
      createdAt: new Date(),
    });
  }

  it('findAllActive returns only active categories sorted by sortOrder', async () => {
    if (!dbAvailable) return;

    const found = await categoryRepository.findAllActive();
    const relevant = found.filter((category) => category.slug.startsWith(TEST_PREFIX));
    expect(relevant.map((category) => category.slug)).toEqual([categoryB.slug, categoryA.slug]);
  });

  it('findByIds returns only the requested rows, including inactive ones', async () => {
    if (!dbAvailable) return;

    const found = await categoryRepository.findByIds([categoryA.id, inactiveCategory.id]);
    expect(found.map((category) => category.cuisineCategoryId).sort()).toEqual(
      [categoryA.id, inactiveCategory.id].sort(),
    );
  });

  it('findByIds returns an empty array for an empty input', async () => {
    if (!dbAvailable) return;

    const found = await categoryRepository.findByIds([]);
    expect(found).toEqual([]);
  });

  it('replaceAllForRestaurant persists rows and findAllByRestaurantId rehydrates them', async () => {
    if (!dbAvailable) return;

    const restaurant = await createRestaurant();
    const entries = [
      buildAssignment(restaurant.id, categoryA.id),
      buildAssignment(restaurant.id, categoryB.id),
    ];
    await assignmentRepository.replaceAllForRestaurant(RestaurantId.create(restaurant.id), entries);

    const found = await assignmentRepository.findAllByRestaurantId(
      RestaurantId.create(restaurant.id),
    );
    expect(found).toHaveLength(2);
    expect(found.map((entry) => entry.cuisineCategoryId).sort()).toEqual(
      [categoryA.id, categoryB.id].sort(),
    );
  });

  it('replaceAllForRestaurant fully replaces the previous assignment (delete + recreate), never duplicating rows', async () => {
    if (!dbAvailable) return;

    const restaurant = await createRestaurant();
    await assignmentRepository.replaceAllForRestaurant(RestaurantId.create(restaurant.id), [
      buildAssignment(restaurant.id, categoryA.id),
      buildAssignment(restaurant.id, categoryB.id),
    ]);

    await assignmentRepository.replaceAllForRestaurant(RestaurantId.create(restaurant.id), [
      buildAssignment(restaurant.id, categoryA.id),
    ]);

    const found = await assignmentRepository.findAllByRestaurantId(
      RestaurantId.create(restaurant.id),
    );
    expect(found).toHaveLength(1);
    expect(found[0].cuisineCategoryId).toBe(categoryA.id);

    const rowCount = await rawPrisma.restaurantCuisineCategory.count({
      where: { restaurantId: restaurant.id },
    });
    expect(rowCount).toBe(1);
  });

  it('replaceAllForRestaurant with an empty array clears every row', async () => {
    if (!dbAvailable) return;

    const restaurant = await createRestaurant();
    await assignmentRepository.replaceAllForRestaurant(RestaurantId.create(restaurant.id), [
      buildAssignment(restaurant.id, categoryA.id),
    ]);

    await assignmentRepository.replaceAllForRestaurant(RestaurantId.create(restaurant.id), []);

    const found = await assignmentRepository.findAllByRestaurantId(
      RestaurantId.create(restaurant.id),
    );
    expect(found).toEqual([]);
  });

  it('findAllByRestaurantId does NOT filter by tenant context - callers must gate via RestaurantRepository first', async () => {
    if (!dbAvailable) return;

    const restaurant = await createRestaurant();
    await assignmentRepository.replaceAllForRestaurant(RestaurantId.create(restaurant.id), [
      buildAssignment(restaurant.id, categoryA.id),
    ]);

    // No tenant context bound at all, unlike every DIRECT_TENANT_OWNED_MODELS
    // repository (which would throw TenantContextMissingException here).
    const found = await assignmentRepository.findAllByRestaurantId(
      RestaurantId.create(restaurant.id),
    );
    expect(found).toHaveLength(1);
  });
});
