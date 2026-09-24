import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaFloorPlanAreaRepository } from '@modules/tables/infrastructure/persistence/prisma-floor-plan-area.repository';
import { FloorPlanArea } from '@modules/tables/domain/entities/floor-plan-area.entity';
import { FloorPlanAreaId, FloorPlanId } from '@shared/domain/value-objects/identifiers.vo';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

/**
 * ADR-040. `FloorPlanArea` is NOT in `withTenantScoping`'s
 * `DIRECT_TENANT_OWNED_MODELS` (see the repository's own doc comment), so - as
 * in `prisma-floor-plan.integration-spec.ts` - no tenant context is bound
 * around these calls.
 *
 * Beyond the ordinary round trip, this suite proves the two guarantees that
 * live only in hand-written migration SQL and therefore cannot be verified by
 * any unit test: the partial unique index on `(floor_plan_id, name)` and the
 * composite foreign key that binds a table's area to the table's own floor
 * plan.
 */
const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'floor-plan-area-repo-';

describe('FloorPlanArea round-trip via PrismaFloorPlanAreaRepository (integration)', () => {
  let dbAvailable = false;
  let repository: PrismaFloorPlanAreaRepository;
  let org: { id: string };

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([PrismaFloorPlanAreaRepository]);
    repository = moduleRef.get(PrismaFloorPlanAreaRepository);

    org = await rawPrisma.organization.create({
      data: {
        name: 'FloorPlanArea Repo Test Org',
        slug: `${TEST_PREFIX}org-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}@example.com`,
      },
    });
  });

  afterAll(async () => {
    if (!dbAvailable) return;

    await rawPrisma.table.deleteMany({
      where: { branch: { restaurant: { slug: { startsWith: TEST_PREFIX } } } },
    });
    await rawPrisma.floorPlanArea.deleteMany({
      where: { floorPlan: { branch: { restaurant: { slug: { startsWith: TEST_PREFIX } } } } },
    });
    await rawPrisma.floorPlan.deleteMany({
      where: { branch: { restaurant: { slug: { startsWith: TEST_PREFIX } } } },
    });
    await rawPrisma.branch.deleteMany({
      where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
    });
    await rawPrisma.restaurant.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.organization.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.$disconnect();
  });

  async function createBranchWithFloorPlans(): Promise<{
    branchId: string;
    floorPlanId: string;
    otherFloorPlanId: string;
  }> {
    const restaurant = await rawPrisma.restaurant.create({
      data: {
        organizationId: org.id,
        name: 'The Old Mill',
        slug: `${TEST_PREFIX}${randomUUID()}`,
        status: 'Active',
      },
    });
    const branch = await rawPrisma.branch.create({
      data: {
        restaurantId: restaurant.id,
        city: 'Damascus',
        address: '123 Main St',
        countryCode: 'SY',
        timezone: 'Asia/Damascus',
      },
    });
    const floorPlan = await rawPrisma.floorPlan.create({
      data: { branchId: branch.id, name: 'Main Floor', isActive: true },
    });
    const otherFloorPlan = await rawPrisma.floorPlan.create({
      data: { branchId: branch.id, name: 'Patio', isActive: false },
    });
    return {
      branchId: branch.id,
      floorPlanId: floorPlan.id,
      otherFloorPlanId: otherFloorPlan.id,
    };
  }

  function buildArea(
    floorPlanId: string,
    overrides: Partial<{ id: string; name: string; color: string; sortOrder: number }> = {},
  ): FloorPlanArea {
    const now = new Date();
    return FloorPlanArea.create({
      id: overrides.id ?? randomUUID(),
      floorPlanId,
      name: overrides.name ?? 'Main Hall',
      color: overrides.color ?? '#14B8A6',
      sortOrder: overrides.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  it('round-trips an area through save and findByIdAndFloorPlanId', async () => {
    if (!dbAvailable) return;
    const { floorPlanId } = await createBranchWithFloorPlans();
    const area = buildArea(floorPlanId, { name: 'للضيوف', sortOrder: 3 });

    await repository.save(area);

    const found = await repository.findByIdAndFloorPlanId(
      area.floorPlanAreaId,
      FloorPlanId.create(floorPlanId),
    );
    expect(found?.name).toBe('للضيوف');
    expect(found?.color).toBe('#14B8A6');
    expect(found?.sortOrder).toBe(3);
  });

  it('does not return an area through a different floor plan id', async () => {
    if (!dbAvailable) return;
    const { floorPlanId, otherFloorPlanId } = await createBranchWithFloorPlans();
    const area = buildArea(floorPlanId);
    await repository.save(area);

    await expect(
      repository.findByIdAndFloorPlanId(area.floorPlanAreaId, FloorPlanId.create(otherFloorPlanId)),
    ).resolves.toBeNull();
  });

  it('orders the list by sortOrder then createdAt, ascending', async () => {
    if (!dbAvailable) return;
    const { floorPlanId } = await createBranchWithFloorPlans();
    await repository.save(buildArea(floorPlanId, { name: 'Guests', sortOrder: 2 }));
    await repository.save(buildArea(floorPlanId, { name: 'Main Hall', sortOrder: 1 }));
    await repository.save(buildArea(floorPlanId, { name: 'Terrace', sortOrder: 1 }));

    const areas = await repository.findManyByFloorPlanId(FloorPlanId.create(floorPlanId));

    expect(areas.map((a) => a.name)).toEqual(['Main Hall', 'Terrace', 'Guests']);
  });

  it('excludes soft-deleted areas from the list and from lookups', async () => {
    if (!dbAvailable) return;
    const { floorPlanId } = await createBranchWithFloorPlans();
    const area = buildArea(floorPlanId);
    await repository.save(area);
    await repository.save(area.softDelete(new Date()));

    await expect(
      repository.findManyByFloorPlanId(FloorPlanId.create(floorPlanId)),
    ).resolves.toEqual([]);
    await expect(
      repository.findByIdAndFloorPlanId(area.floorPlanAreaId, FloorPlanId.create(floorPlanId)),
    ).resolves.toBeNull();
  });

  it('enforces the partial unique index on (floor_plan_id, name) for live rows', async () => {
    if (!dbAvailable) return;
    const { floorPlanId } = await createBranchWithFloorPlans();
    await repository.save(buildArea(floorPlanId, { name: 'Main Hall' }));

    await expect(repository.save(buildArea(floorPlanId, { name: 'Main Hall' }))).rejects.toThrow();
  });

  it('releases a soft-deleted area name for reuse (the index is partial)', async () => {
    if (!dbAvailable) return;
    const { floorPlanId } = await createBranchWithFloorPlans();
    const first = buildArea(floorPlanId, { name: 'Main Hall' });
    await repository.save(first);
    await repository.save(first.softDelete(new Date()));

    await expect(
      repository.save(buildArea(floorPlanId, { name: 'Main Hall' })),
    ).resolves.toBeUndefined();
  });

  it('allows the same area name in a different floor plan', async () => {
    if (!dbAvailable) return;
    const { floorPlanId, otherFloorPlanId } = await createBranchWithFloorPlans();
    await repository.save(buildArea(floorPlanId, { name: 'Main Hall' }));

    await expect(
      repository.save(buildArea(otherFloorPlanId, { name: 'Main Hall' })),
    ).resolves.toBeUndefined();
  });

  describe('composite foreign key (ADR-040 decision #4)', () => {
    it('accepts a table assigned to an area of its OWN floor plan', async () => {
      if (!dbAvailable) return;
      const { branchId, floorPlanId } = await createBranchWithFloorPlans();
      const area = buildArea(floorPlanId);
      await repository.save(area);

      const table = await rawPrisma.table.create({
        data: {
          branchId,
          floorPlanId,
          floorPlanAreaId: area.floorPlanAreaId.value,
          tableNumber: `T-${randomUUID().slice(0, 8)}`,
          capacity: 4,
          color: '#F97316',
        },
      });

      expect(table.floorPlanAreaId).toBe(area.floorPlanAreaId.value);
      expect(table.color).toBe('#F97316');
    });

    it('rejects, at the database, a table assigned to an area of ANOTHER floor plan', async () => {
      if (!dbAvailable) return;
      const { branchId, floorPlanId, otherFloorPlanId } = await createBranchWithFloorPlans();
      const area = buildArea(otherFloorPlanId);
      await repository.save(area);

      await expect(
        rawPrisma.table.create({
          data: {
            branchId,
            floorPlanId,
            floorPlanAreaId: area.floorPlanAreaId.value,
            tableNumber: `T-${randomUUID().slice(0, 8)}`,
            capacity: 4,
          },
        }),
      ).rejects.toThrow();
    });

    it('allows a table with no area at all (MATCH SIMPLE skips the check)', async () => {
      if (!dbAvailable) return;
      const { branchId, floorPlanId } = await createBranchWithFloorPlans();

      const table = await rawPrisma.table.create({
        data: {
          branchId,
          floorPlanId,
          floorPlanAreaId: null,
          tableNumber: `T-${randomUUID().slice(0, 8)}`,
          capacity: 4,
        },
      });

      expect(table.floorPlanAreaId).toBeNull();
      expect(table.color).toBeNull();
    });
  });

  describe('countAssignedTables (deletion guard input)', () => {
    it('counts live tables and ignores soft-deleted ones', async () => {
      if (!dbAvailable) return;
      const { branchId, floorPlanId } = await createBranchWithFloorPlans();
      const area = buildArea(floorPlanId);
      await repository.save(area);

      await expect(
        repository.countAssignedTables(FloorPlanAreaId.create(area.floorPlanAreaId.value)),
      ).resolves.toBe(0);

      await rawPrisma.table.create({
        data: {
          branchId,
          floorPlanId,
          floorPlanAreaId: area.floorPlanAreaId.value,
          tableNumber: `T-${randomUUID().slice(0, 8)}`,
          capacity: 4,
        },
      });
      await rawPrisma.table.create({
        data: {
          branchId,
          floorPlanId,
          floorPlanAreaId: area.floorPlanAreaId.value,
          tableNumber: `T-${randomUUID().slice(0, 8)}`,
          capacity: 4,
          deletedAt: new Date(),
        },
      });

      await expect(
        repository.countAssignedTables(FloorPlanAreaId.create(area.floorPlanAreaId.value)),
      ).resolves.toBe(1);
    });
  });
});
