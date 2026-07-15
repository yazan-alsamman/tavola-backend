import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';
import { PrismaWorkingHoursRepository } from '@modules/restaurants/infrastructure/persistence/prisma-working-hours.repository';
import { WorkingHours } from '@modules/restaurants/domain/entities/working-hours.entity';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

/**
 * `WorkingHours` is NOT in `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS`
 * (see the repository's own doc comment), so - like
 * `prisma-restaurant-settings.integration-spec.ts` - this spec deliberately
 * does NOT bind a tenant context around every call, and explicitly proves
 * the repository performs no tenant filtering by itself.
 */
const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'working-hours-repo-';

describe('WorkingHours round-trip via PrismaWorkingHoursRepository (integration)', () => {
  let dbAvailable = false;
  let repository: PrismaWorkingHoursRepository;
  let org: { id: string };

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([PrismaWorkingHoursRepository]);
    repository = moduleRef.get(PrismaWorkingHoursRepository);
    // TenantContextService is resolved only to prove it is NOT required for
    // this repository to function - see the "does not require" test below.
    moduleRef.get(TenantContextService);

    org = await rawPrisma.organization.create({
      data: {
        name: 'Working Hours Repo Test Org',
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

  function buildEntry(restaurantId: string, dayOfWeek: number): WorkingHours {
    return WorkingHours.create({
      id: randomUUID(),
      restaurantId,
      dayOfWeek,
      openingTime: '09:00',
      closingTime: '22:00',
      breakStartTime: null,
      breakEndTime: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  it('findAllByRestaurantId returns an empty array when no rows exist yet', async () => {
    if (!dbAvailable) return;

    const found = await repository.findAllByRestaurantId(RestaurantId.create(randomUUID()));
    expect(found).toEqual([]);
  });

  it('replaceAllForRestaurant persists rows and findAllByRestaurantId rehydrates them sorted by dayOfWeek', async () => {
    if (!dbAvailable) return;

    const restaurant = await createRestaurant();
    const entries = [buildEntry(restaurant.id, 5), buildEntry(restaurant.id, 1)];
    await repository.replaceAllForRestaurant(RestaurantId.create(restaurant.id), entries);

    const found = await repository.findAllByRestaurantId(RestaurantId.create(restaurant.id));
    expect(found).toHaveLength(2);
    expect(found.map((entry) => entry.dayOfWeek)).toEqual([1, 5]);
    expect(found[0].openingTime).toBe('09:00');
    expect(found[0].restaurantId.value).toBe(restaurant.id);
  });

  it('replaceAllForRestaurant fully replaces the previous week (delete + recreate), never duplicating rows', async () => {
    if (!dbAvailable) return;

    const restaurant = await createRestaurant();
    await repository.replaceAllForRestaurant(RestaurantId.create(restaurant.id), [
      buildEntry(restaurant.id, 1),
      buildEntry(restaurant.id, 2),
    ]);

    await repository.replaceAllForRestaurant(RestaurantId.create(restaurant.id), [
      buildEntry(restaurant.id, 3),
    ]);

    const found = await repository.findAllByRestaurantId(RestaurantId.create(restaurant.id));
    expect(found).toHaveLength(1);
    expect(found[0].dayOfWeek).toBe(3);

    const rowCount = await rawPrisma.workingHours.count({
      where: { restaurantId: restaurant.id },
    });
    expect(rowCount).toBe(1);
  });

  it('replaceAllForRestaurant with an empty array clears every row (fully closed week)', async () => {
    if (!dbAvailable) return;

    const restaurant = await createRestaurant();
    await repository.replaceAllForRestaurant(RestaurantId.create(restaurant.id), [
      buildEntry(restaurant.id, 1),
    ]);

    await repository.replaceAllForRestaurant(RestaurantId.create(restaurant.id), []);

    const found = await repository.findAllByRestaurantId(RestaurantId.create(restaurant.id));
    expect(found).toEqual([]);
  });

  it('findAllByRestaurantId does NOT filter by tenant context - callers must gate via RestaurantRepository first', async () => {
    if (!dbAvailable) return;

    const restaurant = await createRestaurant();
    await repository.replaceAllForRestaurant(RestaurantId.create(restaurant.id), [
      buildEntry(restaurant.id, 1),
    ]);

    // No tenant context bound at all, unlike every DIRECT_TENANT_OWNED_MODELS
    // repository (which would throw TenantContextMissingException here).
    const found = await repository.findAllByRestaurantId(RestaurantId.create(restaurant.id));
    expect(found).toHaveLength(1);
  });
});
