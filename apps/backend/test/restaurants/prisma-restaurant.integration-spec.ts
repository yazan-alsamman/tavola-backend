import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';
import { TenantContextMissingException } from '@infrastructure/tenancy/tenant-context-missing.exception';
import { PrismaRestaurantRepository } from '@modules/restaurants/infrastructure/persistence/prisma-restaurant.repository';
import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import { RestaurantStatus } from '@modules/restaurants/domain/enums/restaurant.enums';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { RestaurantSlug } from '@shared/domain/value-objects/restaurant-slug.vo';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

/**
 * The raw tenant-scoping extension itself (cross-tenant read/write blocking,
 * TenantContextMissingException, concurrent/transactional isolation) is
 * already exhaustively proven against the `Restaurant` model in
 * `test/tenancy/prisma-tenant-scoping.integration-spec.ts` (Phase 2.13,
 * predates this module). This spec proves the opposite direction:
 * `PrismaRestaurantRepository`/`RestaurantPrismaMapper` correctly build on
 * that already-verified mechanism, not re-testing the mechanism itself.
 */
const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'restaurant-repo-';

describe('Restaurant round-trip via PrismaRestaurantRepository (integration)', () => {
  let dbAvailable = false;
  let tenantContextService: TenantContextService;
  let repository: PrismaRestaurantRepository;
  let orgA: { id: string };
  let orgB: { id: string };

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([PrismaRestaurantRepository]);
    repository = moduleRef.get(PrismaRestaurantRepository);
    tenantContextService = moduleRef.get(TenantContextService);

    orgA = await rawPrisma.organization.create({
      data: {
        name: 'Repo Test Org A',
        slug: `${TEST_PREFIX}org-a-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}a@example.com`,
      },
    });
    orgB = await rawPrisma.organization.create({
      data: {
        name: 'Repo Test Org B',
        slug: `${TEST_PREFIX}org-b-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}b@example.com`,
      },
    });
  });

  afterAll(async () => {
    if (!dbAvailable) return;

    await rawPrisma.restaurant.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.organization.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.$disconnect();
  });

  function asOrgA<T>(fn: () => Promise<T>): Promise<T> {
    return tenantContextService.runAsync(
      { organizationId: orgA.id, userId: null, correlationId: 'test-a' },
      fn,
    );
  }

  function asOrgB<T>(fn: () => Promise<T>): Promise<T> {
    return tenantContextService.runAsync(
      { organizationId: orgB.id, userId: null, correlationId: 'test-b' },
      fn,
    );
  }

  function buildRestaurant(overrides: { slug: string; organizationId: string }): Restaurant {
    const now = new Date();
    return Restaurant.create({
      id: randomUUID(),
      organizationId: overrides.organizationId,
      name: 'The Old Mill',
      slug: overrides.slug,
      logoId: null,
      coverImageId: null,
      description: 'Cozy',
      cuisineType: 'Italian',
      averageRating: null,
      priceLevel: 2,
      status: RestaurantStatus.Active,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  it('persists via save() and rehydrates identically via findById(), scoped to the bound tenant', async () => {
    if (!dbAvailable) return;

    const slug = `${TEST_PREFIX}${randomUUID()}`;
    const restaurant = buildRestaurant({ slug, organizationId: orgA.id });

    await asOrgA(() => repository.save(restaurant));
    const found = await asOrgA(() => repository.findById(restaurant.restaurantId));

    expect(found).not.toBeNull();
    expect(found?.name).toBe('The Old Mill');
    expect(found?.slug.value).toBe(slug);
    expect(found?.organizationId.value).toBe(orgA.id);
  });

  it('findById returns null when the restaurant belongs to a different tenant', async () => {
    if (!dbAvailable) return;

    const slug = `${TEST_PREFIX}${randomUUID()}`;
    const restaurant = buildRestaurant({ slug, organizationId: orgA.id });
    await asOrgA(() => repository.save(restaurant));

    const foundFromOrgB = await asOrgB(() => repository.findById(restaurant.restaurantId));
    expect(foundFromOrgB).toBeNull();
  });

  it('persists updateProfile()/suspend() output correctly', async () => {
    if (!dbAvailable) return;

    const slug = `${TEST_PREFIX}${randomUUID()}`;
    const restaurant = buildRestaurant({ slug, organizationId: orgA.id });
    await asOrgA(() => repository.save(restaurant));

    const at = new Date();
    const updated = restaurant
      .updateProfile({ name: 'New Name', description: null, cuisineType: null, priceLevel: 4 }, at)
      .suspend(at);
    await asOrgA(() => repository.save(updated));

    const found = await asOrgA(() => repository.findById(restaurant.restaurantId));
    expect(found?.name).toBe('New Name');
    expect(found?.priceLevel).toBe(4);
    expect(found?.status).toBe(RestaurantStatus.Suspended);
  });

  it('softDelete() causes findById() to report not found', async () => {
    if (!dbAvailable) return;

    const slug = `${TEST_PREFIX}${randomUUID()}`;
    const restaurant = buildRestaurant({ slug, organizationId: orgA.id });
    await asOrgA(() => repository.save(restaurant));

    const deleted = restaurant.softDelete(new Date());
    await asOrgA(() => repository.save(deleted));

    const found = await asOrgA(() => repository.findById(restaurant.restaurantId));
    expect(found).toBeNull();
  });

  it('existsBySlug is scoped to the bound tenant and excludes soft-deleted rows', async () => {
    if (!dbAvailable) return;

    const slug = `${TEST_PREFIX}${randomUUID()}`;
    const restaurant = buildRestaurant({ slug, organizationId: orgA.id });
    await asOrgA(() => repository.save(restaurant));

    expect(await asOrgA(() => repository.existsBySlug(RestaurantSlug.create(slug)))).toBe(true);

    const deleted = restaurant.softDelete(new Date());
    await asOrgA(() => repository.save(deleted));
    expect(await asOrgA(() => repository.existsBySlug(RestaurantSlug.create(slug)))).toBe(false);
  });

  it("findMany paginates and never returns another tenant's restaurants", async () => {
    if (!dbAvailable) return;

    const slugs = [1, 2, 3].map(() => `${TEST_PREFIX}${randomUUID()}`);
    for (const slug of slugs) {
      await asOrgA(() => repository.save(buildRestaurant({ slug, organizationId: orgA.id })));
    }
    const otherOrgSlug = `${TEST_PREFIX}${randomUUID()}`;
    await asOrgB(() =>
      repository.save(buildRestaurant({ slug: otherOrgSlug, organizationId: orgB.id })),
    );

    const page = await asOrgA(() => repository.findMany(1, 2));
    expect(page.items).toHaveLength(2);
    expect(page.items.every((r) => r.organizationId.value === orgA.id)).toBe(true);
  });

  it('throws TenantContextMissingException when no tenant context is bound', async () => {
    if (!dbAvailable) return;

    await expect(repository.findById(RestaurantId.create(randomUUID()))).rejects.toBeInstanceOf(
      TenantContextMissingException,
    );
  });
});
