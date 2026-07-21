import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaTableRepository } from '@modules/tables/infrastructure/persistence/prisma-table.repository';
import { Table } from '@modules/tables/domain/entities/table.entity';
import { TableShape, TableStatus } from '@modules/tables/domain/enums/table.enums';
import { BranchId, FloorPlanId, TableId } from '@shared/domain/value-objects/identifiers.vo';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

/**
 * `Table` is NOT in `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS` (see
 * the repository's own doc comment), so - like
 * `prisma-branch.integration-spec.ts` - no tenant context is bound around
 * these calls.
 */
const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'table-repo-';

describe('Table round-trip via PrismaTableRepository (integration)', () => {
  let dbAvailable = false;
  let repository: PrismaTableRepository;
  let org: { id: string };

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([PrismaTableRepository]);
    repository = moduleRef.get(PrismaTableRepository);

    org = await rawPrisma.organization.create({
      data: {
        name: 'Table Repo Test Org',
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

  async function createBranchWithFloorPlan(): Promise<{ branchId: string; floorPlanId: string }> {
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
    return { branchId: branch.id, floorPlanId: floorPlan.id };
  }

  function buildTable(
    branchId: string,
    floorPlanId: string,
    overrides: Partial<{ tableNumber: string; capacity: number }> = {},
  ): Table {
    const now = new Date();
    return Table.create({
      id: randomUUID(),
      branchId,
      floorPlanId,
      tableNumber: overrides.tableNumber ?? 'T1',
      capacity: overrides.capacity ?? 4,
      floor: 1,
      positionX: 10.5,
      positionY: 20.5,
      width: 100,
      height: 100,
      rotation: 0,
      shape: TableShape.Rectangle,
      layer: 0,
      indoor: true,
      vip: false,
      smoking: false,
      status: TableStatus.Available,
      mergeGroupId: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  it('save persists a table and findByIdAndBranchId rehydrates it, including Decimal->number fields', async () => {
    if (!dbAvailable) return;

    const { branchId, floorPlanId } = await createBranchWithFloorPlan();
    const table = buildTable(branchId, floorPlanId);
    await repository.save(table);

    const found = await repository.findByIdAndBranchId(table.tableId, BranchId.create(branchId));
    expect(found).not.toBeNull();
    expect(found?.tableNumber).toBe('T1');
    expect(found?.positionX).toBe(10.5);
    expect(found?.shape).toBe(TableShape.Rectangle);
    expect(found?.status).toBe(TableStatus.Available);
    expect(found?.mergeGroupId).toBeNull();
  });

  it('save persists a Move Table floorPlanId reassignment (Phase 6.2), leaving other fields untouched', async () => {
    if (!dbAvailable) return;

    const { branchId, floorPlanId } = await createBranchWithFloorPlan();
    const otherFloorPlan = await rawPrisma.floorPlan.create({
      data: { branchId, name: 'Patio', isActive: false },
    });
    const table = buildTable(branchId, floorPlanId);
    await repository.save(table);

    const moved = table.moveToFloorPlan(otherFloorPlan.id, new Date());
    await repository.save(moved);

    const found = await repository.findByIdAndBranchId(table.tableId, BranchId.create(branchId));
    expect(found?.floorPlanId.value).toBe(otherFloorPlan.id);
    expect(found?.tableNumber).toBe('T1');
    expect(found?.capacity).toBe(4);
  });

  it('save persists a Status Management transition, leaving other fields untouched', async () => {
    if (!dbAvailable) return;

    const { branchId, floorPlanId } = await createBranchWithFloorPlan();
    const table = buildTable(branchId, floorPlanId);
    await repository.save(table);

    const occupied = table.transitionStatus(TableStatus.Occupied, new Date());
    await repository.save(occupied);

    const found = await repository.findByIdAndBranchId(table.tableId, BranchId.create(branchId));
    expect(found?.status).toBe(TableStatus.Occupied);
    expect(found?.tableNumber).toBe('T1');
    expect(found?.capacity).toBe(4);
  });

  it('findById (no branch filter) resolves the flat-route lookup', async () => {
    if (!dbAvailable) return;

    const { branchId, floorPlanId } = await createBranchWithFloorPlan();
    const table = buildTable(branchId, floorPlanId);
    await repository.save(table);

    const found = await repository.findById(table.tableId);
    expect(found).not.toBeNull();
    expect(found?.branchId.value).toBe(branchId);
  });

  it('findByIdAndBranchId returns null when the table belongs to a different branch', async () => {
    if (!dbAvailable) return;

    const a = await createBranchWithFloorPlan();
    const b = await createBranchWithFloorPlan();
    const table = buildTable(a.branchId, a.floorPlanId);
    await repository.save(table);

    const found = await repository.findByIdAndBranchId(table.tableId, BranchId.create(b.branchId));
    expect(found).toBeNull();
  });

  it('findManyByFloorPlanId scopes to one floor plan only', async () => {
    if (!dbAvailable) return;

    const { branchId, floorPlanId } = await createBranchWithFloorPlan();
    const otherFloorPlan = await rawPrisma.floorPlan.create({
      data: { branchId, name: 'Patio', isActive: false },
    });
    await repository.save(buildTable(branchId, floorPlanId, { tableNumber: 'T1' }));
    await repository.save(buildTable(branchId, floorPlanId, { tableNumber: 'T2' }));
    await repository.save(buildTable(branchId, otherFloorPlan.id, { tableNumber: 'T3' }));

    const page = await repository.findManyByFloorPlanId(FloorPlanId.create(floorPlanId), 1, 20);
    expect(page.total).toBe(2);
    expect(page.items.map((item) => item.tableNumber).sort()).toEqual(['T1', 'T2']);
  });

  it('existsByBranchIdAndTableNumber enforces uniqueness within a branch, excluding a given id on update', async () => {
    if (!dbAvailable) return;

    const { branchId, floorPlanId } = await createBranchWithFloorPlan();
    const table = buildTable(branchId, floorPlanId, { tableNumber: 'T1' });
    await repository.save(table);

    expect(await repository.existsByBranchIdAndTableNumber(BranchId.create(branchId), 'T1')).toBe(
      true,
    );
    expect(
      await repository.existsByBranchIdAndTableNumber(
        BranchId.create(branchId),
        'T1',
        table.tableId,
      ),
    ).toBe(false);
  });

  it('softDeleteAllForBranch soft-deletes every table of one branch only', async () => {
    if (!dbAvailable) return;

    const a = await createBranchWithFloorPlan();
    const b = await createBranchWithFloorPlan();
    await repository.save(buildTable(a.branchId, a.floorPlanId, { tableNumber: 'T1' }));
    await repository.save(buildTable(a.branchId, a.floorPlanId, { tableNumber: 'T2' }));
    await repository.save(buildTable(b.branchId, b.floorPlanId, { tableNumber: 'T1' }));

    await repository.softDeleteAllForBranch(BranchId.create(a.branchId), new Date());

    const pageA = await repository.findManyByBranchId(BranchId.create(a.branchId), 1, 20);
    expect(pageA.total).toBe(0);

    const pageB = await repository.findManyByBranchId(BranchId.create(b.branchId), 1, 20);
    expect(pageB.total).toBe(1);
  });

  it('a soft-deleted table is excluded from findById/findByIdAndBranchId', async () => {
    if (!dbAvailable) return;

    const { branchId, floorPlanId } = await createBranchWithFloorPlan();
    const table = buildTable(branchId, floorPlanId);
    await repository.save(table);
    await repository.save(table.softDelete(new Date()));

    expect(await repository.findById(table.tableId)).toBeNull();
    expect(
      await repository.findByIdAndBranchId(table.tableId, BranchId.create(branchId)),
    ).toBeNull();
  });

  it('does NOT filter by tenant context - callers must gate via Restaurant/Branch repositories first', async () => {
    if (!dbAvailable) return;

    const { branchId, floorPlanId } = await createBranchWithFloorPlan();
    const table = buildTable(branchId, floorPlanId);
    await repository.save(table);

    const found = await repository.findById(TableId.create(table.tableId.value));
    expect(found).not.toBeNull();
  });
});
