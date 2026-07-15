import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';
import { PrismaRestaurantSettingsRepository } from '@modules/restaurants/infrastructure/persistence/prisma-restaurant-settings.repository';
import { RestaurantSettings } from '@modules/restaurants/domain/entities/restaurant-settings.entity';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

/**
 * `RestaurantSettings` is NOT in `withTenantScoping`'s
 * `DIRECT_TENANT_OWNED_MODELS` (see the repository's own doc comment), so
 * unlike `prisma-restaurant.integration-spec.ts` this spec deliberately does
 * NOT bind a tenant context around every call, and explicitly proves the
 * repository performs no tenant filtering by itself - that responsibility
 * belongs to the calling use case, which must resolve the parent
 * `Restaurant` via the tenant-scoped `RestaurantRepository` first.
 */
const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'restaurant-settings-repo-';

describe('RestaurantSettings round-trip via PrismaRestaurantSettingsRepository (integration)', () => {
  let dbAvailable = false;
  let repository: PrismaRestaurantSettingsRepository;
  let org: { id: string };

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([PrismaRestaurantSettingsRepository]);
    repository = moduleRef.get(PrismaRestaurantSettingsRepository);
    // TenantContextService is resolved only to prove it is NOT required for
    // this repository to function - see the "does not require" test below.
    moduleRef.get(TenantContextService);

    org = await rawPrisma.organization.create({
      data: {
        name: 'Settings Repo Test Org',
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

  function buildDefaultSettings(restaurantId: string): RestaurantSettings {
    return RestaurantSettings.createDefault(randomUUID(), restaurantId, new Date());
  }

  it('findByRestaurantId returns null when no settings row exists yet', async () => {
    if (!dbAvailable) return;

    const found = await repository.findByRestaurantId(RestaurantId.create(randomUUID()));
    expect(found).toBeNull();
  });

  it('persists via save() and rehydrates identically via findByRestaurantId() - no tenant context required', async () => {
    if (!dbAvailable) return;

    const restaurant = await createRestaurant();
    const settings = buildDefaultSettings(restaurant.id);
    await repository.save(settings);

    const found = await repository.findByRestaurantId(RestaurantId.create(restaurant.id));
    expect(found).not.toBeNull();
    expect(found?.restaurantId.value).toBe(restaurant.id);
    expect(found?.reservationIntervalMinutes).toBe(30);
    expect(found?.maxGuestsPerReservation).toBe(20);
    expect(found?.cancellationWindowMinutes).toBe(60);
    expect(found?.pendingReservationTimeoutMinutes).toBe(15);
    expect(found?.autoApproval).toBe(false);
    expect(found?.timezone).toBe('UTC');
    expect(found?.defaultCurrency).toBeNull();
  });

  it('save() upserts: a second save() with the same id replaces the row instead of duplicating it', async () => {
    if (!dbAvailable) return;

    const restaurant = await createRestaurant();
    const settings = buildDefaultSettings(restaurant.id);
    await repository.save(settings);

    const updated = settings.updateSettings(
      {
        reservationIntervalMinutes: 45,
        maxGuestsPerReservation: 12,
        cancellationWindowMinutes: 120,
        pendingReservationTimeoutMinutes: 30,
        autoApproval: true,
        timezone: 'Europe/Istanbul',
        defaultCurrency: 'TRY',
      },
      new Date(),
    );
    await repository.save(updated);

    const found = await repository.findByRestaurantId(RestaurantId.create(restaurant.id));
    expect(found?.reservationIntervalMinutes).toBe(45);
    expect(found?.defaultCurrency).toBe('TRY');

    const rowCount = await rawPrisma.restaurantSettings.count({
      where: { restaurantId: restaurant.id },
    });
    expect(rowCount).toBe(1);
  });

  it('findByRestaurantId does NOT filter by tenant context - callers must gate via RestaurantRepository first', async () => {
    if (!dbAvailable) return;

    const restaurant = await createRestaurant();
    const settings = buildDefaultSettings(restaurant.id);
    await repository.save(settings);

    // No tenant context bound at all, unlike every DIRECT_TENANT_OWNED_MODELS
    // repository (which would throw TenantContextMissingException here).
    const found = await repository.findByRestaurantId(RestaurantId.create(restaurant.id));
    expect(found).not.toBeNull();
  });
});
