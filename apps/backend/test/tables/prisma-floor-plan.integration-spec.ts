import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaFloorPlanRepository } from '@modules/tables/infrastructure/persistence/prisma-floor-plan.repository';
import { FloorPlan } from '@modules/tables/domain/entities/floor-plan.entity';
import { BranchId } from '@shared/domain/value-objects/identifiers.vo';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

/**
 * `FloorPlan` is NOT in `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS`
 * (see the repository's own doc comment), so - like
 * `prisma-branch.integration-spec.ts` - no tenant context is bound around
 * these calls.
 */
const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'floor-plan-repo-';

describe('FloorPlan round-trip via PrismaFloorPlanRepository (integration)', () => {
  let dbAvailable = false;
  let repository: PrismaFloorPlanRepository;
  let org: { id: string };

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([PrismaFloorPlanRepository]);
    repository = moduleRef.get(PrismaFloorPlanRepository);

    org = await rawPrisma.organization.create({
      data: {
        name: 'FloorPlan Repo Test Org',
        slug: `${TEST_PREFIX}org-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}@example.com`,
      },
    });
  });

  afterAll(async () => {
    if (!dbAvailable) return;

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

  async function createBranch(): Promise<{ id: string }> {
    const restaurant = await rawPrisma.restaurant.create({
      data: {
        organizationId: org.id,
        name: 'The Old Mill',
        slug: `${TEST_PREFIX}${randomUUID()}`,
        status: 'Active',
      },
    });
    return rawPrisma.branch.create({
      data: {
        restaurantId: restaurant.id,
        city: 'Damascus',
        address: '123 Main St',
        countryCode: 'SY',
        timezone: 'Asia/Damascus',
      },
    });
  }

  function buildFloorPlan(branchId: string, overrides: Partial<{ name: string }> = {}): FloorPlan {
    const now = new Date();
    return FloorPlan.create({
      id: randomUUID(),
      branchId,
      name: overrides.name ?? 'Main Floor',
      isActive: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  it('save persists a floor plan and findByIdAndBranchId rehydrates it', async () => {
    if (!dbAvailable) return;

    const branch = await createBranch();
    const floorPlan = buildFloorPlan(branch.id);
    await repository.save(floorPlan);

    const found = await repository.findByIdAndBranchId(
      floorPlan.floorPlanId,
      BranchId.create(branch.id),
    );
    expect(found).not.toBeNull();
    expect(found?.name).toBe('Main Floor');
    expect(found?.isActive).toBe(true);
  });

  it('findByIdAndBranchId returns null when the floor plan belongs to a different branch', async () => {
    if (!dbAvailable) return;

    const branchA = await createBranch();
    const branchB = await createBranch();
    const floorPlan = buildFloorPlan(branchA.id);
    await repository.save(floorPlan);

    const found = await repository.findByIdAndBranchId(
      floorPlan.floorPlanId,
      BranchId.create(branchB.id),
    );
    expect(found).toBeNull();
  });

  it('existsAnyForBranch reflects only non-soft-deleted rows', async () => {
    if (!dbAvailable) return;

    const branch = await createBranch();
    expect(await repository.existsAnyForBranch(BranchId.create(branch.id))).toBe(false);

    const floorPlan = buildFloorPlan(branch.id);
    await repository.save(floorPlan);
    expect(await repository.existsAnyForBranch(BranchId.create(branch.id))).toBe(true);

    await repository.save(
      FloorPlan.reconstitute({ ...floorPlan.toProps(), deletedAt: new Date() }),
    );
    expect(await repository.existsAnyForBranch(BranchId.create(branch.id))).toBe(false);
  });

  it('activate atomically deactivates the previously active floor plan of the same branch', async () => {
    if (!dbAvailable) return;

    const branch = await createBranch();
    const first = buildFloorPlan(branch.id, { name: 'Main Floor' });
    await repository.save(first);
    const second = buildFloorPlan(branch.id, { name: 'Patio' });
    await repository.save(FloorPlan.reconstitute({ ...second.toProps(), isActive: false }));

    const activated = await repository.activate(
      second.floorPlanId,
      BranchId.create(branch.id),
      new Date(),
    );
    expect(activated.isActive).toBe(true);

    const firstAfter = await repository.findByIdAndBranchId(
      first.floorPlanId,
      BranchId.create(branch.id),
    );
    expect(firstAfter?.isActive).toBe(false);

    const activeCount = await rawPrisma.floorPlan.count({
      where: { branchId: branch.id, isActive: true, deletedAt: null },
    });
    expect(activeCount).toBe(1);
  });

  it('softDeleteAllForBranch soft-deletes every floor plan of one branch only', async () => {
    if (!dbAvailable) return;

    const branchA = await createBranch();
    const branchB = await createBranch();
    await repository.save(buildFloorPlan(branchA.id, { name: 'Main Floor' }));
    await repository.save(
      FloorPlan.reconstitute({
        ...buildFloorPlan(branchA.id, { name: 'Patio' }).toProps(),
        isActive: false,
      }),
    );
    await repository.save(buildFloorPlan(branchB.id, { name: 'Other Branch Floor' }));

    await repository.softDeleteAllForBranch(BranchId.create(branchA.id), new Date());

    const remainingA = await repository.findManyByBranchId(BranchId.create(branchA.id));
    expect(remainingA).toEqual([]);

    const remainingB = await repository.findManyByBranchId(BranchId.create(branchB.id));
    expect(remainingB).toHaveLength(1);
  });

  it('does NOT filter by tenant context - callers must gate via Restaurant/Branch repositories first', async () => {
    if (!dbAvailable) return;

    const branch = await createBranch();
    const floorPlan = buildFloorPlan(branch.id);
    await repository.save(floorPlan);

    const found = await repository.findByIdAndBranchId(
      floorPlan.floorPlanId,
      BranchId.create(branch.id),
    );
    expect(found).not.toBeNull();
  });
});
