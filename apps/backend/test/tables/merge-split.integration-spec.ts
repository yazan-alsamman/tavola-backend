import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { PrismaTableRepository } from '@modules/tables/infrastructure/persistence/prisma-table.repository';
import { PrismaBranchRepository } from '@modules/branches/infrastructure/persistence/prisma-branch.repository';
import { PrismaRestaurantRepository } from '@modules/restaurants/infrastructure/persistence/prisma-restaurant.repository';
import { PrismaReservationRepository } from '@modules/reservations/infrastructure/persistence/prisma-reservation.repository';
import { PrismaUnitOfWork } from '@modules/authentication/infrastructure/persistence/prisma-unit-of-work';
import { MergeTablesUseCase } from '@modules/tables/application/use-cases/merge-tables.use-case';
import { SplitTablesUseCase } from '@modules/tables/application/use-cases/split-tables.use-case';
import { TableStatus } from '@modules/tables/domain/enums/table.enums';
import { TableNotMergedException } from '@modules/tables/domain/exceptions/table-not-merged.exception';
import { TableMergeConflictException } from '@modules/tables/domain/exceptions/table-merge-conflict.exception';
import { TableUnavailableException } from '@modules/reservations/domain/exceptions/table-unavailable.exception';
import { Reservation } from '@modules/reservations/domain/entities/reservation.entity';
import { ReservationSource } from '@modules/reservations/domain/enums/reservation.enums';
import { ReservationAvailabilityService } from '@modules/reservations/domain/services/reservation-availability.service';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { BranchId, TableId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CollectingEventPublisher,
  FixedClock,
  UuidGenerator,
} from '../authentication/support/in-memory-registration.dependencies';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

/**
 * Phase 6 (Merge/Split Tables, architecture frozen 2026-07-25, ADR-026)
 * integration coverage against real PostgreSQL: the two hand-written
 * database constraints migration `20260725230000_phase_6_merge_split_tables`
 * adds (a CHECK Prisma's schema DSL cannot express, and a partial UNIQUE
 * index), `MergeTablesUseCase`/`SplitTablesUseCase` wired with REAL
 * repositories + a REAL `PrismaUnitOfWork` (not the in-memory doubles
 * `merge-tables.use-case.spec.ts`/`split-tables.use-case.spec.ts` already
 * exercise), transaction rollback, and the real Postgres advisory-lock
 * concurrency guarantees ADR-026 decision #7 promises (sorted topology locks,
 * no deadlock, exactly-one-winner races) - mirroring
 * `waitlist-promotion-concurrency.integration-spec.ts`'s own "real Postgres,
 * real advisory locks" precedent.
 */
const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'merge-split-int-';

describe('Phase 6 Merge/Split Tables - schema, atomicity, and concurrency (integration)', () => {
  let dbAvailable = false;
  let tenantContextService: TenantContextService;
  let prismaContext: PrismaContext;
  let tableRepository: PrismaTableRepository;
  let reservationRepository: PrismaReservationRepository;
  let unitOfWork: PrismaUnitOfWork;
  let mergeUseCase: MergeTablesUseCase;
  let splitUseCase: SplitTablesUseCase;
  let org: { id: string };

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([
      PrismaTableRepository,
      PrismaBranchRepository,
      PrismaRestaurantRepository,
      PrismaReservationRepository,
      PrismaUnitOfWork,
    ]);
    tenantContextService = moduleRef.get(TenantContextService);
    prismaContext = moduleRef.get(PrismaContext);
    tableRepository = moduleRef.get(PrismaTableRepository);
    const branchRepository = moduleRef.get(PrismaBranchRepository);
    const restaurantRepository = moduleRef.get(PrismaRestaurantRepository);
    reservationRepository = moduleRef.get(PrismaReservationRepository);
    unitOfWork = moduleRef.get(PrismaUnitOfWork);

    mergeUseCase = new MergeTablesUseCase(
      tableRepository,
      branchRepository,
      restaurantRepository,
      reservationRepository,
      new FixedClock(new Date('2026-08-01T12:00:00.000Z')),
      new UuidGenerator(),
      new CollectingEventPublisher(),
      unitOfWork,
    );
    splitUseCase = new SplitTablesUseCase(
      tableRepository,
      branchRepository,
      restaurantRepository,
      reservationRepository,
      new FixedClock(new Date('2026-08-01T12:00:00.000Z')),
      new UuidGenerator(),
      new CollectingEventPublisher(),
      unitOfWork,
    );

    org = await rawPrisma.organization.create({
      data: {
        name: 'Merge Split Integration Test Org',
        slug: `${TEST_PREFIX}org-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}@example.com`,
      },
    });
  });

  afterAll(async () => {
    if (!dbAvailable) return;

    await rawPrisma.reservation.deleteMany({
      where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
    });
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

  async function seedBranch(): Promise<{ restaurantId: string; branchId: string; floorPlanId: string }> {
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
    return { restaurantId: restaurant.id, branchId: branch.id, floorPlanId: floorPlan.id };
  }

  async function createTable(
    branchId: string,
    floorPlanId: string,
    tableNumber: string,
    capacity = 4,
    overrides: Partial<{ status: TableStatus; mergeGroupId: string | null; isMergePrimary: boolean }> = {},
  ): Promise<string> {
    const table = await rawPrisma.table.create({
      data: {
        branchId,
        floorPlanId,
        tableNumber,
        capacity,
        status: overrides.status ?? 'Available',
        mergeGroupId: overrides.mergeGroupId,
        isMergePrimary: overrides.isMergePrimary ?? false,
      },
    });
    return table.id;
  }

  function orgMemberActor(organizationId: string) {
    return {
      actorType: AccessTokenActorType.OrganizationMember as const,
      userId: 'owner-user',
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
      organizationId,
      orgRole: 'Owner',
      permissionsVersion: 1,
    };
  }

  function asOrg<T>(organizationId: string, fn: () => Promise<T>): Promise<T> {
    return tenantContextService.runAsync(
      { organizationId, userId: null, correlationId: `test-${randomUUID()}` },
      fn,
    );
  }

  async function mergeAsOwner(
    _restaurantId: string,
    tableIds: string[],
    primaryTableId?: string,
  ) {
    return asOrg(org.id, () =>
      mergeUseCase.execute({ actor: orgMemberActor(org.id), tableIds, primaryTableId }),
    );
  }

  async function splitAsOwner(tableId: string) {
    return asOrg(org.id, () => splitUseCase.execute({ actor: orgMemberActor(org.id), tableId }));
  }

  // -------------------------------------------------------------------
  // Schema: TableStatus.Merged + the two hand-written constraints
  // -------------------------------------------------------------------

  describe('Schema (ADR-026 hand-written constraints, migration 20260725230000)', () => {
    it('accepts TableStatus.Merged for a secondary (isMergePrimary=false) member of an active group', async () => {
      if (!dbAvailable) return;

      const { branchId, floorPlanId } = await seedBranch();
      const groupId = randomUUID();
      const secondaryId = await createTable(branchId, floorPlanId, 'T1', 2, {
        status: TableStatus.Merged,
        mergeGroupId: groupId,
        isMergePrimary: false,
      });

      const row = await rawPrisma.table.findUnique({ where: { id: secondaryId } });
      expect(row?.status).toBe('Merged');
      expect(row?.mergeGroupId).toBe(groupId);
    });

    it('CHECK tables_merge_primary_requires_group_check: isMergePrimary=true with mergeGroupId=null is rejected', async () => {
      if (!dbAvailable) return;

      const { branchId, floorPlanId } = await seedBranch();
      const tableId = await createTable(branchId, floorPlanId, 'T1', 4);

      await expect(
        rawPrisma.table.update({
          where: { id: tableId },
          data: { isMergePrimary: true, mergeGroupId: null },
        }),
      ).rejects.toThrow();

      const row = await rawPrisma.table.findUnique({ where: { id: tableId } });
      expect(row?.isMergePrimary).toBe(false);
    });

    it('partial UNIQUE tables_merge_group_one_primary_key: a second primary in the same active group is rejected', async () => {
      if (!dbAvailable) return;

      const { branchId, floorPlanId } = await seedBranch();
      const groupId = randomUUID();
      await createTable(branchId, floorPlanId, 'T1', 4, {
        status: TableStatus.Available,
        mergeGroupId: groupId,
        isMergePrimary: true,
      });
      const secondaryId = await createTable(branchId, floorPlanId, 'T2', 2, {
        status: TableStatus.Merged,
        mergeGroupId: groupId,
        isMergePrimary: false,
      });

      await expect(
        rawPrisma.table.update({
          where: { id: secondaryId },
          data: { isMergePrimary: true, status: 'Available' },
        }),
      ).rejects.toThrow();

      const row = await rawPrisma.table.findUnique({ where: { id: secondaryId } });
      expect(row?.isMergePrimary).toBe(false);
    });

    it('the partial unique index does NOT block two different active groups from each having their own primary', async () => {
      if (!dbAvailable) return;

      const { branchId, floorPlanId } = await seedBranch();
      const groupA = randomUUID();
      const groupB = randomUUID();
      await createTable(branchId, floorPlanId, 'T1', 4, {
        mergeGroupId: groupA,
        isMergePrimary: true,
      });
      await createTable(branchId, floorPlanId, 'T2', 4, {
        mergeGroupId: groupB,
        isMergePrimary: true,
      });
      // No assertion needed beyond "did not throw" - both rows above.
    });

    it('the partial unique index does NOT block multiple unmerged tables (mergeGroupId=null, isMergePrimary=false)', async () => {
      if (!dbAvailable) return;

      const { branchId, floorPlanId } = await seedBranch();
      await createTable(branchId, floorPlanId, 'T1', 4);
      await createTable(branchId, floorPlanId, 'T2', 4);
      // No assertion needed beyond "did not throw" - both default rows above.
    });
  });

  // -------------------------------------------------------------------
  // Atomic Merge / Split via the real use cases
  // -------------------------------------------------------------------

  describe('Atomic Merge (MergeTablesUseCase, real repos + PrismaUnitOfWork)', () => {
    it('merges 2 Available tables into one group, persisting the primary/secondary split atomically', async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, floorPlanId } = await seedBranch();
      const tableA = await createTable(branchId, floorPlanId, 'T1', 4);
      const tableB = await createTable(branchId, floorPlanId, 'T2', 2);

      const result = await mergeAsOwner(restaurantId, [tableA, tableB], tableA);

      expect(result.primaryTableId).toBe(tableA);
      expect(result.effectiveCapacity).toBe(6);

      const rowA = await rawPrisma.table.findUnique({ where: { id: tableA } });
      const rowB = await rawPrisma.table.findUnique({ where: { id: tableB } });
      expect(rowA?.isMergePrimary).toBe(true);
      expect(rowA?.status).toBe('Available');
      expect(rowB?.isMergePrimary).toBe(false);
      expect(rowB?.status).toBe('Merged');
      expect(rowA?.mergeGroupId).toBe(rowB?.mergeGroupId);
      // Permanent capacity columns are never overwritten (ADR-026 decision #4).
      expect(rowA?.capacity).toBe(4);
      expect(rowB?.capacity).toBe(2);
    });
  });

  describe('Atomic Split (SplitTablesUseCase, real repos + PrismaUnitOfWork)', () => {
    it('splits an active merge group back into independent Available tables', async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, floorPlanId } = await seedBranch();
      const tableA = await createTable(branchId, floorPlanId, 'T1', 4);
      const tableB = await createTable(branchId, floorPlanId, 'T2', 2);
      await mergeAsOwner(restaurantId, [tableA, tableB], tableA);

      const result = await splitAsOwner(tableB);

      expect(result.primaryTableId).toBe(tableA);
      const rowA = await rawPrisma.table.findUnique({ where: { id: tableA } });
      const rowB = await rawPrisma.table.findUnique({ where: { id: tableB } });
      expect(rowA?.mergeGroupId).toBeNull();
      expect(rowA?.isMergePrimary).toBe(false);
      expect(rowA?.status).toBe('Available');
      expect(rowB?.mergeGroupId).toBeNull();
      expect(rowB?.isMergePrimary).toBe(false);
      expect(rowB?.status).toBe('Available');
    });
  });

  // -------------------------------------------------------------------
  // Rollback: a forced mid-transaction failure leaves state unchanged
  // -------------------------------------------------------------------

  describe('Rollback (forced mid-transaction failure, no partial state)', () => {
    it('a Merge-shaped transaction rolls back entirely when the second save fails mid-transaction', async () => {
      if (!dbAvailable) return;

      const { branchId, floorPlanId } = await seedBranch();
      const tableA = await createTable(branchId, floorPlanId, 'T1', 4);
      const tableB = await createTable(branchId, floorPlanId, 'T2', 2);
      // Force tableB out of Available directly (bypassing the use case) so
      // that Table.asMergeSecondary() throws mid-transaction, AFTER
      // tableA's own primary mutation has already been staged via save().
      await rawPrisma.table.update({ where: { id: tableB }, data: { status: 'Occupied' } });

      const mergeGroupId = randomUUID();
      const now = new Date('2026-08-01T12:00:00.000Z');

      await expect(
        prismaContext.runInTransaction(async () => {
          await tableRepository.acquireTopologyLocks([tableA, tableB]);
          const a = await tableRepository.findById(TableId.create(tableA));
          const b = await tableRepository.findById(TableId.create(tableB));
          const primary = a!.asMergePrimary(mergeGroupId, now);
          await tableRepository.save(primary);
          // tableB is Occupied - this throws, rolling back the whole transaction,
          // including tableA's already-`save()`d mutation above.
          const secondary = b!.asMergeSecondary(mergeGroupId, now);
          await tableRepository.save(secondary);
        }),
      ).rejects.toThrow(TableMergeConflictException);

      const reloadedA = await tableRepository.findById(TableId.create(tableA));
      const reloadedB = await tableRepository.findById(TableId.create(tableB));
      expect(reloadedA?.mergeGroupId).toBeNull();
      expect(reloadedA?.isMergePrimary).toBe(false);
      expect(reloadedA?.status).toBe(TableStatus.Available);
      expect(reloadedB?.status).toBe(TableStatus.Occupied);
      expect(reloadedB?.mergeGroupId).toBeNull();
    });

    it('a Split-shaped transaction rolls back entirely when the second member save fails mid-transaction', async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, floorPlanId } = await seedBranch();
      const tableA = await createTable(branchId, floorPlanId, 'T1', 4);
      const tableB = await createTable(branchId, floorPlanId, 'T2', 2);
      const merged = await mergeAsOwner(restaurantId, [tableA, tableB], tableA);

      // Simulate a race: tableB's membership was already cleared by another
      // process between this test's own load and its transaction below.
      await rawPrisma.table.update({
        where: { id: tableB },
        data: { mergeGroupId: null, isMergePrimary: false, status: 'Available' },
      });

      const now = new Date('2026-08-01T12:05:00.000Z');

      await expect(
        prismaContext.runInTransaction(async () => {
          await tableRepository.acquireTopologyLocks([tableA, tableB]);
          const a = await tableRepository.findById(TableId.create(tableA));
          const cleared = a!.clearMergeMembership(now);
          await tableRepository.save(cleared);
          // tableB's mergeGroupId is already null on the freshly reloaded
          // entity - clearMergeMembership() throws, rolling back the whole
          // transaction, including tableA's already-`save()`d mutation above.
          const b = await tableRepository.findById(TableId.create(tableB));
          const clearedB = b!.clearMergeMembership(now);
          await tableRepository.save(clearedB);
        }),
      ).rejects.toThrow(TableNotMergedException);

      const reloadedA = await tableRepository.findById(TableId.create(tableA));
      expect(reloadedA?.mergeGroupId).toBe(merged.mergeGroupId);
      expect(reloadedA?.isMergePrimary).toBe(true);
      expect(reloadedA?.status).toBe(TableStatus.Available);
    });
  });

  // -------------------------------------------------------------------
  // Concurrency: real Postgres advisory locks (ADR-026 decision #7)
  // -------------------------------------------------------------------

  describe('Concurrency (real Postgres, real advisory locks)', () => {
    it('concurrent duplicate Merge attempts on the SAME pair: exactly one wins, the other loses to the re-check inside the lock', async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, floorPlanId } = await seedBranch();
      const tableA = await createTable(branchId, floorPlanId, 'T1', 4);
      const tableB = await createTable(branchId, floorPlanId, 'T2', 2);

      const attempts = 5;
      const outcomes = await Promise.allSettled(
        Array.from({ length: attempts }, () => mergeAsOwner(restaurantId, [tableA, tableB], tableA)),
      );

      const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
      const rejected = outcomes.filter((o) => o.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(attempts - 1);
      for (const outcome of rejected) {
        expect((outcome as PromiseRejectedResult).reason).toBeInstanceOf(TableMergeConflictException);
      }

      const rowA = await rawPrisma.table.findUnique({ where: { id: tableA } });
      expect(rowA?.isMergePrimary).toBe(true);
    });

    it('no deadlock when concurrent Merge requests list the SAME pair of table ids in reverse order (sorted topology-lock acquisition)', async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, floorPlanId } = await seedBranch();
      const tableA = await createTable(branchId, floorPlanId, 'T1', 4);
      const tableB = await createTable(branchId, floorPlanId, 'T2', 2);

      const outcomes = await Promise.allSettled([
        mergeAsOwner(restaurantId, [tableA, tableB]),
        mergeAsOwner(restaurantId, [tableB, tableA]),
      ]);

      // The mere fact this resolves at all (within Jest's own test timeout)
      // proves no deadlock; the exactly-one-winner assertion below is a
      // bonus consistency check, not the point of this test.
      const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
      expect(fulfilled).toHaveLength(1);
    });

    it('concurrent duplicate Split attempts on the SAME group: exactly one wins, the other sees the group already dissolved', async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, floorPlanId } = await seedBranch();
      const tableA = await createTable(branchId, floorPlanId, 'T1', 4);
      const tableB = await createTable(branchId, floorPlanId, 'T2', 2);
      await mergeAsOwner(restaurantId, [tableA, tableB], tableA);

      const attempts = 5;
      const outcomes = await Promise.allSettled(
        Array.from({ length: attempts }, () => splitAsOwner(tableB)),
      );

      const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
      const rejected = outcomes.filter((o) => o.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(attempts - 1);
      for (const outcome of rejected) {
        expect((outcome as PromiseRejectedResult).reason).toBeInstanceOf(TableNotMergedException);
      }

      const rowA = await rawPrisma.table.findUnique({ where: { id: tableA } });
      expect(rowA?.mergeGroupId).toBeNull();
    });

    it('overlapping Merge sets sharing one table (A+B vs B+C): only one merge wins, the other loses to the re-check', async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, floorPlanId } = await seedBranch();
      const tableA = await createTable(branchId, floorPlanId, 'T1', 4);
      const tableB = await createTable(branchId, floorPlanId, 'T2', 2);
      const tableC = await createTable(branchId, floorPlanId, 'T3', 6);

      const outcomes = await Promise.allSettled([
        mergeAsOwner(restaurantId, [tableA, tableB], tableA),
        mergeAsOwner(restaurantId, [tableB, tableC], tableC),
      ]);

      const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
      const rejected = outcomes.filter((o) => o.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(TableMergeConflictException);

      // Whichever merge won, table B (the shared, contested table) belongs to
      // exactly one group, never both and never neither.
      const rowB = await rawPrisma.table.findUnique({ where: { id: tableB } });
      expect(rowB?.mergeGroupId).not.toBeNull();
      const rowA = await rawPrisma.table.findUnique({ where: { id: tableA } });
      const rowC = await rawPrisma.table.findUnique({ where: { id: tableC } });
      const aMerged = rowA?.mergeGroupId !== null;
      const cMerged = rowC?.mergeGroupId !== null;
      expect(aMerged !== cMerged).toBe(true);
      expect(aMerged ? rowA?.mergeGroupId : rowC?.mergeGroupId).toBe(rowB?.mergeGroupId);
    });

    /**
     * ADR-026 decision #7's "Compatibility with ADR-013/023" clause: a
     * Reservation Create-shaped transaction acquires the SAME sorted
     * topology lock, BEFORE its own ADR-013 slot lock, exactly like
     * `CreateReservationUseCase` itself (reproduced here directly rather than
     * constructing the full use case, which needs several unrelated
     * dependencies - `ReservationGuestRepository`, the expiration scheduler,
     * `ScheduleApprovedReservationSignalsService` - that add nothing to this
     * concurrency proof). `primaryTableId: tableB` is fixed so tableA is
     * ALWAYS the one that would become a Merged secondary if the merge wins
     * - making the outcome deterministic regardless of which transaction's
     * advisory lock acquisition wins the race.
     */
    it('Merge vs a Reservation Create-shaped transaction on the same table: the topology lock serializes them into exactly one consistent outcome', async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, floorPlanId } = await seedBranch();
      const tableA = await createTable(branchId, floorPlanId, 'T1', 4);
      const tableB = await createTable(branchId, floorPlanId, 'T2', 6);
      const now = new Date('2027-01-10T17:00:00.000Z');
      const reservationStartTime = new Date('2027-01-10T18:00:00.000Z');
      const user = await rawPrisma.user.create({
        data: {
          firstName: 'Test',
          lastName: 'Customer',
          email: `${TEST_PREFIX}user-${randomUUID()}@example.com`,
          passwordHash: 'argon2id$fake$not-used-by-this-spec',
          language: 'en',
        },
      });
      const reservation = Reservation.createAutoApproved({
        id: randomUUID(),
        userId: user.id,
        reservationGuestId: null,
        source: ReservationSource.Online,
        restaurantId,
        branchId,
        tableId: tableA,
        reservationDate: new Date('2027-01-10T00:00:00.000Z'),
        reservationStartTime,
        reservationEndTime: new Date('2027-01-10T19:30:00.000Z'),
        guests: 2,
        tableCapacity: 4,
        notes: null,
        createdBy: user.id,
        now,
      });
      const lockKey = ReservationAvailabilityService.deriveLockKey(
        branchId,
        tableA,
        reservation.reservationDate,
        ReservationAvailabilityService.deriveTimeSlotBucket(reservation.reservationStartTime, 30),
      );

      const reservationAttempt = prismaContext.runInTransaction(async () => {
        await tableRepository.acquireTopologyLocks([tableA]);
        const table = await tableRepository.findById(TableId.create(tableA));
        if (table === null || table.status !== TableStatus.Available) {
          throw new TableUnavailableException();
        }
        await reservationRepository.createWithLockInTransaction(reservation, lockKey);
        const reserved = table.reserve(reservation.reservationId.value, now);
        await tableRepository.save(reserved);
      });
      const mergeAttempt = mergeAsOwner(restaurantId, [tableA, tableB], tableB);

      const [reservationOutcome, mergeOutcome] = await Promise.allSettled([
        reservationAttempt,
        mergeAttempt,
      ]);

      const reloadedA = await tableRepository.findById(TableId.create(tableA));
      const reservationCount = await rawPrisma.reservation.count({
        where: { tableId: tableA, status: 'Approved' },
      });

      if (reloadedA?.mergeGroupId !== null) {
        // Merge won the race - tableA is the secondary (Merged), never reserved.
        expect(reloadedA?.status).toBe(TableStatus.Merged);
        expect(reservationCount).toBe(0);
        expect(mergeOutcome.status).toBe('fulfilled');
        expect(reservationOutcome.status).toBe('rejected');
      } else {
        // The reservation won the race - tableA is Reserved, never merged.
        expect(reloadedA?.status).toBe(TableStatus.Reserved);
        expect(reservationCount).toBe(1);
        expect(reservationOutcome.status).toBe('fulfilled');
        expect(mergeOutcome.status).toBe('rejected');
      }
    });
  });

  // -------------------------------------------------------------------
  // effectiveCapacity in findManyAvailableByBranchIdAndMinCapacity
  // -------------------------------------------------------------------

  describe('effectiveCapacity in findManyAvailableByBranchIdAndMinCapacity (ADR-026 decision #4/#14)', () => {
    it("a merged primary's effective (combined) capacity, not its own raw capacity, satisfies minCapacity", async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, floorPlanId } = await seedBranch();
      const tableA = await createTable(branchId, floorPlanId, 'T1', 4);
      const tableB = await createTable(branchId, floorPlanId, 'T2', 2);
      await mergeAsOwner(restaurantId, [tableA, tableB], tableA);

      const byBranchId = BranchId.create(branchId);
      const tooHigh = await tableRepository.findManyAvailableByBranchIdAndMinCapacity(
        byBranchId,
        7,
      );
      expect(tooHigh.map((t) => t.tableId.value)).not.toContain(tableA);

      const satisfiedByCombinedOnly = await tableRepository.findManyAvailableByBranchIdAndMinCapacity(
        byBranchId,
        6,
      );
      expect(satisfiedByCombinedOnly.map((t) => t.tableId.value)).toContain(tableA);
      // Table A's own raw `capacity` column is never overwritten.
      const primaryResult = satisfiedByCombinedOnly.find((t) => t.tableId.value === tableA)!;
      expect(primaryResult.capacity).toBe(4);
    });

    it('a Merged secondary is never returned as a candidate, regardless of minCapacity', async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, floorPlanId } = await seedBranch();
      const tableA = await createTable(branchId, floorPlanId, 'T1', 4);
      const tableB = await createTable(branchId, floorPlanId, 'T2', 2);
      await mergeAsOwner(restaurantId, [tableA, tableB], tableA);

      const byBranchId = BranchId.create(branchId);
      const results = await tableRepository.findManyAvailableByBranchIdAndMinCapacity(byBranchId, 1);
      expect(results.map((t) => t.tableId.value)).not.toContain(tableB);
    });

    it('after Split, each former member is filtered by its own independent capacity again', async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, floorPlanId } = await seedBranch();
      const tableA = await createTable(branchId, floorPlanId, 'T1', 4);
      const tableB = await createTable(branchId, floorPlanId, 'T2', 2);
      await mergeAsOwner(restaurantId, [tableA, tableB], tableA);
      await splitAsOwner(tableB);

      const byBranchId = BranchId.create(branchId);
      const results = await tableRepository.findManyAvailableByBranchIdAndMinCapacity(byBranchId, 3);
      expect(results.map((t) => t.tableId.value)).toContain(tableA);
      expect(results.map((t) => t.tableId.value)).not.toContain(tableB);
    });
  });

  // -------------------------------------------------------------------
  // Historical reservation validity after Split (no Table row is ever
  // created/destroyed - "Split = undo merge only")
  // -------------------------------------------------------------------

  describe('Historical Reservation.tableId remains valid after Split', () => {
    it("a past (already-ended) Approved reservation's tableId still resolves to a real, independent Table after Split", async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, floorPlanId } = await seedBranch();
      const tableA = await createTable(branchId, floorPlanId, 'T1', 4);
      const tableB = await createTable(branchId, floorPlanId, 'T2', 2);
      await mergeAsOwner(restaurantId, [tableA, tableB], tableA);

      const user = await rawPrisma.user.create({
        data: {
          firstName: 'Test',
          lastName: 'Customer',
          email: `${TEST_PREFIX}user-${randomUUID()}@example.com`,
          passwordHash: 'argon2id$fake$not-used-by-this-spec',
          language: 'en',
        },
      });
      const historicalReservation = await rawPrisma.reservation.create({
        data: {
          userId: user.id,
          restaurantId,
          branchId,
          tableId: tableA,
          reservationDate: new Date('2020-01-01T00:00:00.000Z'),
          reservationStartTime: new Date('2020-01-01T18:00:00.000Z'),
          reservationEndTime: new Date('2020-01-01T19:30:00.000Z'),
          guests: 2,
          status: 'Approved',
          source: 'Online',
          createdBy: user.id,
          approvedBy: user.id,
          approvedAt: new Date('2020-01-01T17:00:00.000Z'),
        },
      });

      // Already ended - hasBlockingReservation is false, so Split is allowed
      // to proceed even though this Approved reservation still exists.
      const result = await splitAsOwner(tableB);
      expect(result.primaryTableId).toBe(tableA);

      const reloadedReservation = await rawPrisma.reservation.findUnique({
        where: { id: historicalReservation.id },
      });
      expect(reloadedReservation?.tableId).toBe(tableA);
      expect(reloadedReservation?.status).toBe('Approved');

      // tableA is now an ordinary, independent Table row again - not deleted,
      // not re-created - "Split = undo merge only" (ADR-026 decision #2).
      const tableRow = await rawPrisma.table.findUnique({ where: { id: tableA } });
      expect(tableRow).not.toBeNull();
      expect(tableRow?.mergeGroupId).toBeNull();
      expect(tableRow?.deletedAt).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // hasBlockingReservation blocking Merge/Split (ADR-026 decision #6)
  // -------------------------------------------------------------------

  describe('hasBlockingReservation blocks Merge/Split (ADR-026 decision #6)', () => {
    it.each(['Pending', 'Approved'] as const)(
      'blocks Merge when a component has a %s reservation whose reservationEndTime is still in the future',
      async (status) => {
        if (!dbAvailable) return;

        const { restaurantId, branchId, floorPlanId } = await seedBranch();
        const tableA = await createTable(branchId, floorPlanId, 'T1', 4);
        const tableB = await createTable(branchId, floorPlanId, 'T2', 2);
        const user = await rawPrisma.user.create({
          data: {
            firstName: 'Test',
            lastName: 'Customer',
            email: `${TEST_PREFIX}user-${randomUUID()}@example.com`,
            passwordHash: 'argon2id$fake$not-used-by-this-spec',
            language: 'en',
          },
        });
        await rawPrisma.reservation.create({
          data: {
            userId: user.id,
            restaurantId,
            branchId,
            tableId: tableA,
            reservationDate: new Date('2027-02-01T00:00:00.000Z'),
            reservationStartTime: new Date('2027-02-01T18:00:00.000Z'),
            reservationEndTime: new Date('2027-02-01T19:30:00.000Z'),
            guests: 2,
            status,
            source: 'Online',
            createdBy: user.id,
          },
        });

        await expect(mergeAsOwner(restaurantId, [tableA, tableB], tableA)).rejects.toBeInstanceOf(
          TableMergeConflictException,
        );

        const rowA = await rawPrisma.table.findUnique({ where: { id: tableA } });
        expect(rowA?.mergeGroupId).toBeNull();
      },
    );

    it.each(['Rejected', 'Cancelled', 'Expired'] as const)(
      'does NOT block Merge for a %s reservation (non-blocking status)',
      async (status) => {
        if (!dbAvailable) return;

        const { restaurantId, branchId, floorPlanId } = await seedBranch();
        const tableA = await createTable(branchId, floorPlanId, 'T1', 4);
        const tableB = await createTable(branchId, floorPlanId, 'T2', 2);
        const user = await rawPrisma.user.create({
          data: {
            firstName: 'Test',
            lastName: 'Customer',
            email: `${TEST_PREFIX}user-${randomUUID()}@example.com`,
            passwordHash: 'argon2id$fake$not-used-by-this-spec',
            language: 'en',
          },
        });
        await rawPrisma.reservation.create({
          data: {
            userId: user.id,
            restaurantId,
            branchId,
            tableId: tableA,
            reservationDate: new Date('2027-02-02T00:00:00.000Z'),
            reservationStartTime: new Date('2027-02-02T18:00:00.000Z'),
            reservationEndTime: new Date('2027-02-02T19:30:00.000Z'),
            guests: 2,
            status,
            source: 'Online',
            createdBy: user.id,
          },
        });

        const result = await mergeAsOwner(restaurantId, [tableA, tableB], tableA);
        expect(result.primaryTableId).toBe(tableA);
      },
    );

    it('blocks Split when the PRIMARY has a future Approved reservation, even though the target id given is a secondary', async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, floorPlanId } = await seedBranch();
      const tableA = await createTable(branchId, floorPlanId, 'T1', 4);
      const tableB = await createTable(branchId, floorPlanId, 'T2', 2);
      await mergeAsOwner(restaurantId, [tableA, tableB], tableA);

      const user = await rawPrisma.user.create({
        data: {
          firstName: 'Test',
          lastName: 'Customer',
          email: `${TEST_PREFIX}user-${randomUUID()}@example.com`,
          passwordHash: 'argon2id$fake$not-used-by-this-spec',
          language: 'en',
        },
      });
      await rawPrisma.reservation.create({
        data: {
          userId: user.id,
          restaurantId,
          branchId,
          tableId: tableA,
          reservationDate: new Date('2027-02-03T00:00:00.000Z'),
          reservationStartTime: new Date('2027-02-03T18:00:00.000Z'),
          reservationEndTime: new Date('2027-02-03T19:30:00.000Z'),
          guests: 2,
          status: 'Approved',
          source: 'Online',
          createdBy: user.id,
        },
      });

      await expect(splitAsOwner(tableB)).rejects.toBeInstanceOf(TableMergeConflictException);

      const rowA = await rawPrisma.table.findUnique({ where: { id: tableA } });
      expect(rowA?.mergeGroupId).not.toBeNull();
    });
  });
});
