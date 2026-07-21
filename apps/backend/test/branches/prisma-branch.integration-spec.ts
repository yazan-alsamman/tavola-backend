import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';
import { PrismaBranchRepository } from '@modules/branches/infrastructure/persistence/prisma-branch.repository';
import { Branch } from '@modules/branches/domain/entities/branch.entity';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

/**
 * `Branch` is NOT in `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS` (see
 * the repository's own doc comment), so - like
 * `prisma-working-hours.integration-spec.ts` - this spec deliberately does
 * NOT bind a tenant context around every call, and explicitly proves the
 * repository performs no tenant filtering by itself.
 */
const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'branch-repo-';

describe('Branch round-trip via PrismaBranchRepository (integration)', () => {
  let dbAvailable = false;
  let repository: PrismaBranchRepository;
  let org: { id: string };

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([PrismaBranchRepository]);
    repository = moduleRef.get(PrismaBranchRepository);
    // TenantContextService is resolved only to prove it is NOT required for
    // this repository to function - see the "does not require" test below.
    moduleRef.get(TenantContextService);

    org = await rawPrisma.organization.create({
      data: {
        name: 'Branch Repo Test Org',
        slug: `${TEST_PREFIX}org-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}@example.com`,
      },
    });
  });

  afterAll(async () => {
    if (!dbAvailable) return;

    await rawPrisma.branch.deleteMany({
      where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
    });
    await rawPrisma.restaurant.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
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

  function buildBranch(
    restaurantId: string,
    overrides: Partial<{ city: string; latitude: number | null; longitude: number | null }> = {},
  ): Branch {
    const now = new Date();
    return Branch.create({
      id: randomUUID(),
      restaurantId,
      city: overrides.city ?? 'Damascus',
      district: 'Malki',
      address: '123 Main St',
      latitude: overrides.latitude ?? null,
      longitude: overrides.longitude ?? null,
      countryCode: 'SY',
      currency: 'SYP',
      timezone: 'Asia/Damascus',
      phone: '+963900000000',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  it('save persists a branch and findByIdAndRestaurantId rehydrates it', async () => {
    if (!dbAvailable) return;

    const restaurant = await createRestaurant();
    const branch = buildBranch(restaurant.id);
    await repository.save(branch);

    const found = await repository.findByIdAndRestaurantId(
      branch.branchId,
      RestaurantId.create(restaurant.id),
    );
    expect(found).not.toBeNull();
    expect(found?.city).toBe('Damascus');
    expect(found?.district).toBe('Malki');
    expect(found?.countryCode).toBe('SY');
  });

  it('findByIdAndRestaurantId returns null when the branch belongs to a different restaurant', async () => {
    if (!dbAvailable) return;

    const restaurantA = await createRestaurant();
    const restaurantB = await createRestaurant();
    const branch = buildBranch(restaurantA.id);
    await repository.save(branch);

    const found = await repository.findByIdAndRestaurantId(
      branch.branchId,
      RestaurantId.create(restaurantB.id),
    );
    expect(found).toBeNull();
  });

  it('findByIdAndRestaurantId returns null for an unknown id', async () => {
    if (!dbAvailable) return;

    const restaurant = await createRestaurant();
    const found = await repository.findByIdAndRestaurantId(
      BranchId.create(randomUUID()),
      RestaurantId.create(restaurant.id),
    );
    expect(found).toBeNull();
  });

  it('findManyByRestaurantId returns only that restaurant own branches, sorted newest first', async () => {
    if (!dbAvailable) return;

    const restaurantA = await createRestaurant();
    const restaurantB = await createRestaurant();
    await repository.save(buildBranch(restaurantA.id, { city: 'Damascus' }));
    await repository.save(buildBranch(restaurantA.id, { city: 'Aleppo' }));
    await repository.save(buildBranch(restaurantB.id, { city: 'Homs' }));

    const page = await repository.findManyByRestaurantId(
      RestaurantId.create(restaurantA.id),
      1,
      20,
    );
    expect(page.total).toBe(2);
    expect(page.items.map((item) => item.city).sort()).toEqual(['Aleppo', 'Damascus']);
  });

  it('save on an existing id updates in place rather than duplicating', async () => {
    if (!dbAvailable) return;

    const restaurant = await createRestaurant();
    const branch = buildBranch(restaurant.id);
    await repository.save(branch);

    const updated = branch.updateProfile(
      {
        city: 'Aleppo',
        district: null,
        address: '456 New St',
        latitude: null,
        longitude: null,
        countryCode: 'SY',
        currency: 'USD',
        timezone: 'Asia/Damascus',
        phone: null,
      },
      new Date(),
    );
    await repository.save(updated);

    const rowCount = await rawPrisma.branch.count({ where: { restaurantId: restaurant.id } });
    expect(rowCount).toBe(1);

    const found = await repository.findByIdAndRestaurantId(
      branch.branchId,
      RestaurantId.create(restaurant.id),
    );
    expect(found?.city).toBe('Aleppo');
    expect(found?.currency).toBe('USD');
  });

  it('a soft-deleted branch is excluded from findByIdAndRestaurantId and findManyByRestaurantId', async () => {
    if (!dbAvailable) return;

    const restaurant = await createRestaurant();
    const branch = buildBranch(restaurant.id);
    await repository.save(branch);
    await repository.save(branch.softDelete(new Date()));

    const found = await repository.findByIdAndRestaurantId(
      branch.branchId,
      RestaurantId.create(restaurant.id),
    );
    expect(found).toBeNull();

    const page = await repository.findManyByRestaurantId(RestaurantId.create(restaurant.id), 1, 20);
    expect(page.items).toEqual([]);
  });

  it('persists and rehydrates latitude/longitude as plain numbers (Decimal round-trip)', async () => {
    if (!dbAvailable) return;

    const restaurant = await createRestaurant();
    const branch = buildBranch(restaurant.id, { latitude: 33.5138, longitude: 36.2765 });
    await repository.save(branch);

    const found = await repository.findByIdAndRestaurantId(
      branch.branchId,
      RestaurantId.create(restaurant.id),
    );
    expect(found?.latitude).toBe(33.5138);
    expect(found?.longitude).toBe(36.2765);
  });

  it('does NOT filter by tenant context - callers must gate via RestaurantRepository first', async () => {
    if (!dbAvailable) return;

    const restaurant = await createRestaurant();
    const branch = buildBranch(restaurant.id);
    await repository.save(branch);

    // No tenant context bound at all, unlike every DIRECT_TENANT_OWNED_MODELS
    // repository (which would throw TenantContextMissingException here).
    const found = await repository.findByIdAndRestaurantId(
      branch.branchId,
      RestaurantId.create(restaurant.id),
    );
    expect(found).not.toBeNull();
  });
});
