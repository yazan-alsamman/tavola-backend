import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';
import { PrismaRestaurantGalleryRepository } from '@modules/restaurants/infrastructure/persistence/prisma-restaurant-gallery.repository';
import { RestaurantGalleryImage } from '@modules/restaurants/domain/entities/restaurant-gallery-image.entity';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

/**
 * `RestaurantGallery` is NOT in `withTenantScoping`'s
 * `DIRECT_TENANT_OWNED_MODELS` (see the repository's own doc comment), so -
 * like `prisma-working-hours.integration-spec.ts` - this spec deliberately
 * does NOT bind a tenant context around every call, and explicitly proves
 * the repository performs no tenant filtering by itself.
 */
const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'restaurant-gallery-repo-';

describe('RestaurantGallery round-trip via PrismaRestaurantGalleryRepository (integration)', () => {
  let dbAvailable = false;
  let repository: PrismaRestaurantGalleryRepository;
  let org: { id: string };

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([PrismaRestaurantGalleryRepository]);
    repository = moduleRef.get(PrismaRestaurantGalleryRepository);
    // TenantContextService is resolved only to prove it is NOT required for
    // this repository to function - see the "does not require" test below.
    moduleRef.get(TenantContextService);

    org = await rawPrisma.organization.create({
      data: {
        name: 'Gallery Repo Test Org',
        slug: `${TEST_PREFIX}org-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}@example.com`,
      },
    });
  });

  afterAll(async () => {
    if (!dbAvailable) return;

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

  function buildImage(
    restaurantId: string,
    sortOrder: number,
    caption: string | null = null,
  ): RestaurantGalleryImage {
    return RestaurantGalleryImage.create({
      id: randomUUID(),
      restaurantId,
      fileId: randomUUID(),
      caption,
      sortOrder,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  it('findAllByRestaurantId returns an empty array when no rows exist yet', async () => {
    if (!dbAvailable) return;

    const found = await repository.findAllByRestaurantId(RestaurantId.create(randomUUID()));
    expect(found).toEqual([]);
  });

  it('add() persists a row and findAllByRestaurantId rehydrates it, sorted by sortOrder', async () => {
    if (!dbAvailable) return;

    const restaurant = await createRestaurant();
    await repository.add(buildImage(restaurant.id, 1, 'Second'));
    await repository.add(buildImage(restaurant.id, 0, 'First'));

    const found = await repository.findAllByRestaurantId(RestaurantId.create(restaurant.id));
    expect(found).toHaveLength(2);
    expect(found.map((image) => image.caption)).toEqual(['First', 'Second']);
  });

  it('findById returns the row only when it belongs to the given restaurantId', async () => {
    if (!dbAvailable) return;

    const restaurantA = await createRestaurant();
    const restaurantB = await createRestaurant();
    const image = buildImage(restaurantA.id, 0);
    await repository.add(image);

    const foundForOwner = await repository.findById(
      image.galleryImageId,
      RestaurantId.create(restaurantA.id),
    );
    expect(foundForOwner?.galleryImageId).toBe(image.galleryImageId);

    const foundForOtherRestaurant = await repository.findById(
      image.galleryImageId,
      RestaurantId.create(restaurantB.id),
    );
    expect(foundForOtherRestaurant).toBeNull();
  });

  it('remove() deletes the row', async () => {
    if (!dbAvailable) return;

    const restaurant = await createRestaurant();
    const image = buildImage(restaurant.id, 0);
    await repository.add(image);

    await repository.remove(image.galleryImageId);

    const found = await repository.findAllByRestaurantId(RestaurantId.create(restaurant.id));
    expect(found).toEqual([]);
  });

  it('findAllByRestaurantId does NOT filter by tenant context - callers must gate via RestaurantRepository first', async () => {
    if (!dbAvailable) return;

    const restaurant = await createRestaurant();
    await repository.add(buildImage(restaurant.id, 0));

    // No tenant context bound at all, unlike every DIRECT_TENANT_OWNED_MODELS
    // repository (which would throw TenantContextMissingException here).
    const found = await repository.findAllByRestaurantId(RestaurantId.create(restaurant.id));
    expect(found).toHaveLength(1);
  });
});
