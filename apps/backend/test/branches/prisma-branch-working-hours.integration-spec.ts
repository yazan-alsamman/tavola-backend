import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';
import { PrismaBranchWorkingHoursRepository } from '@modules/branches/infrastructure/persistence/prisma-branch-working-hours.repository';
import { BranchWorkingHours } from '@modules/branches/domain/entities/branch-working-hours.entity';
import { BranchId } from '@shared/domain/value-objects/identifiers.vo';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

/**
 * `BranchWorkingHours` is NOT in `withTenantScoping`'s
 * `DIRECT_TENANT_OWNED_MODELS` (see the repository's own doc comment), so -
 * like `prisma-working-hours.integration-spec.ts` - this spec deliberately
 * does NOT bind a tenant context around every call, and explicitly proves the
 * repository performs no tenant filtering by itself.
 */
const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'branch-working-hours-repo-';

describe('BranchWorkingHours round-trip via PrismaBranchWorkingHoursRepository (integration)', () => {
  let dbAvailable = false;
  let repository: PrismaBranchWorkingHoursRepository;
  let org: { id: string };

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([PrismaBranchWorkingHoursRepository]);
    repository = moduleRef.get(PrismaBranchWorkingHoursRepository);
    // TenantContextService is resolved only to prove it is NOT required for
    // this repository to function - see the "does not require" test below.
    moduleRef.get(TenantContextService);

    org = await rawPrisma.organization.create({
      data: {
        name: 'Branch Working Hours Repo Test Org',
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

  function buildEntry(branchId: string, dayOfWeek: number): BranchWorkingHours {
    return BranchWorkingHours.create({
      id: randomUUID(),
      branchId,
      dayOfWeek,
      openingTime: '09:00',
      closingTime: '22:00',
      breakStartTime: null,
      breakEndTime: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  it('findAllByBranchId returns an empty array when no rows exist yet', async () => {
    if (!dbAvailable) return;

    const found = await repository.findAllByBranchId(BranchId.create(randomUUID()));
    expect(found).toEqual([]);
  });

  it('replaceAllForBranch persists rows and findAllByBranchId rehydrates them sorted by dayOfWeek', async () => {
    if (!dbAvailable) return;

    const branch = await createBranch();
    const entries = [buildEntry(branch.id, 5), buildEntry(branch.id, 1)];
    await repository.replaceAllForBranch(BranchId.create(branch.id), entries);

    const found = await repository.findAllByBranchId(BranchId.create(branch.id));
    expect(found).toHaveLength(2);
    expect(found.map((entry) => entry.dayOfWeek)).toEqual([1, 5]);
    expect(found[0].openingTime).toBe('09:00');
    expect(found[0].branchId.value).toBe(branch.id);
  });

  it('replaceAllForBranch fully replaces the previous week (delete + recreate), never duplicating rows', async () => {
    if (!dbAvailable) return;

    const branch = await createBranch();
    await repository.replaceAllForBranch(BranchId.create(branch.id), [
      buildEntry(branch.id, 1),
      buildEntry(branch.id, 2),
    ]);

    await repository.replaceAllForBranch(BranchId.create(branch.id), [buildEntry(branch.id, 3)]);

    const found = await repository.findAllByBranchId(BranchId.create(branch.id));
    expect(found).toHaveLength(1);
    expect(found[0].dayOfWeek).toBe(3);

    const rowCount = await rawPrisma.branchWorkingHours.count({
      where: { branchId: branch.id },
    });
    expect(rowCount).toBe(1);
  });

  it('replaceAllForBranch with an empty array clears every row', async () => {
    if (!dbAvailable) return;

    const branch = await createBranch();
    await repository.replaceAllForBranch(BranchId.create(branch.id), [buildEntry(branch.id, 1)]);

    await repository.replaceAllForBranch(BranchId.create(branch.id), []);

    const found = await repository.findAllByBranchId(BranchId.create(branch.id));
    expect(found).toEqual([]);
  });

  it('findAllByBranchId does NOT filter by tenant context - callers must gate via RestaurantRepository/BranchRepository first', async () => {
    if (!dbAvailable) return;

    const branch = await createBranch();
    await repository.replaceAllForBranch(BranchId.create(branch.id), [buildEntry(branch.id, 1)]);

    // No tenant context bound at all, unlike every DIRECT_TENANT_OWNED_MODELS
    // repository (which would throw TenantContextMissingException here).
    const found = await repository.findAllByBranchId(BranchId.create(branch.id));
    expect(found).toHaveLength(1);
  });
});
