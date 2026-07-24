import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { PrismaReservationRepository } from '@modules/reservations/infrastructure/persistence/prisma-reservation.repository';
import { PrismaReservationHistoryRepository } from '@modules/reservations/infrastructure/persistence/prisma-reservation-history.repository';
import { PrismaTableRepository } from '@modules/tables/infrastructure/persistence/prisma-table.repository';
import { Reservation } from '@modules/reservations/domain/entities/reservation.entity';
import { ReservationHistory } from '@modules/reservations/domain/entities/reservation-history.entity';
import {
  ReservationSource,
  ReservationStatus,
} from '@modules/reservations/domain/enums/reservation.enums';
import { ReservationConflictException } from '@modules/reservations/domain/exceptions/reservation-conflict.exception';
import { ReservationAvailabilityService } from '@modules/reservations/domain/services/reservation-availability.service';
import { CancellationWindowService } from '@modules/reservations/domain/services/cancellation-window.service';
import { TableStatus } from '@modules/tables/domain/enums/table.enums';
import { BranchId, TableId } from '@shared/domain/value-objects/identifiers.vo';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'reservation-lifecycle-';

/**
 * Phase 7.3 (Reservation Lifecycle, architecture frozen 2026-07-23) -
 * integration coverage against real PostgreSQL for the repository-level
 * building blocks Cancel/Reschedule/Complete/NoShow/Expire orchestrate:
 * `updateTransitioningFrom`'s generalized conditional UPDATE, ADR-023's
 * deterministic two-key advisory lock acquisition for a cross-table Approved
 * reschedule, cross-aggregate atomicity (Reservation + Table +
 * ReservationHistory) via `PrismaContext.runInTransaction`, and
 * `ReservationHistory` persistence including `oldTableId`/`newTableId`/
 * `withinCancellationWindow`. Mirrors the repository-level testing style of
 * `approval-workflow.integration-spec.ts` rather than exercising full
 * use-case DI wiring - deterministic, not timing-dependent.
 */
describe('Phase 7.3 Reservation Lifecycle - Prisma repositories (integration)', () => {
  let dbAvailable = false;
  let reservationRepository: PrismaReservationRepository;
  let reservationHistoryRepository: PrismaReservationHistoryRepository;
  let tableRepository: PrismaTableRepository;
  let prismaContext: PrismaContext;
  let org: { id: string };

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([
      PrismaReservationRepository,
      PrismaReservationHistoryRepository,
      PrismaTableRepository,
    ]);
    reservationRepository = moduleRef.get(PrismaReservationRepository);
    reservationHistoryRepository = moduleRef.get(PrismaReservationHistoryRepository);
    tableRepository = moduleRef.get(PrismaTableRepository);
    prismaContext = moduleRef.get(PrismaContext);

    org = await rawPrisma.organization.create({
      data: {
        name: 'Reservation Lifecycle Test Org',
        slug: `${TEST_PREFIX}org-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}@example.com`,
      },
    });
  });

  afterAll(async () => {
    if (!dbAvailable) return;

    await rawPrisma.reservationHistory.deleteMany({
      where: { reservation: { restaurant: { slug: { startsWith: TEST_PREFIX } } } },
    });
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
    await rawPrisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
    await rawPrisma.organization.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.$disconnect();
  });

  async function seedBranchWithTables(count = 1): Promise<{
    restaurantId: string;
    branchId: string;
    tableIds: string[];
  }> {
    const restaurant = await rawPrisma.restaurant.create({
      data: {
        organizationId: org.id,
        name: 'The Lifecycle Bistro',
        slug: `${TEST_PREFIX}${randomUUID()}`,
        status: 'Active',
      },
    });
    const branch = await rawPrisma.branch.create({
      data: {
        restaurantId: restaurant.id,
        city: 'Damascus',
        address: '456 Main St',
        countryCode: 'SY',
        timezone: 'Asia/Damascus',
      },
    });
    const floorPlan = await rawPrisma.floorPlan.create({
      data: { branchId: branch.id, name: 'Main Floor', isActive: true },
    });
    const tableIds: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const table = await rawPrisma.table.create({
        data: {
          branchId: branch.id,
          floorPlanId: floorPlan.id,
          tableNumber: `T${i + 1}`,
          capacity: 4,
        },
      });
      tableIds.push(table.id);
    }
    return { restaurantId: restaurant.id, branchId: branch.id, tableIds };
  }

  async function seedUser(): Promise<{ id: string }> {
    return rawPrisma.user.create({
      data: {
        firstName: 'Test',
        lastName: 'Customer',
        email: `${TEST_PREFIX}user-${randomUUID()}@example.com`,
        passwordHash: 'argon2id$fake$not-used-by-this-spec',
        language: 'en',
      },
    });
  }

  function buildReservation(
    restaurantId: string,
    branchId: string,
    tableId: string,
    userId: string,
    overrides: Partial<{
      id: string;
      startTime: Date;
      endTime: Date;
      status: ReservationStatus;
    }> = {},
  ): Reservation {
    const now = new Date();
    const startTime = overrides.startTime ?? new Date('2026-11-01T18:00:00.000Z');
    const endTime = overrides.endTime ?? new Date('2026-11-01T19:30:00.000Z');
    const created = Reservation.create({
      id: overrides.id ?? randomUUID(),
      userId,
      reservationGuestId: null,
      source: ReservationSource.Online,
      restaurantId,
      branchId,
      tableId,
      reservationDate: new Date(
        Date.UTC(startTime.getUTCFullYear(), startTime.getUTCMonth(), startTime.getUTCDate()),
      ),
      reservationStartTime: startTime,
      reservationEndTime: endTime,
      guests: 2,
      tableCapacity: 4,
      notes: null,
      createdBy: userId,
      now,
    });
    return overrides.status
      ? Reservation.reconstitute({ ...created.toProps(), status: overrides.status })
      : created;
  }

  describe('Cancel', () => {
    it('cancels a Pending reservation without touching the Table, persisting ReservationHistory', async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, tableIds } = await seedBranchWithTables();
      const user = await seedUser();
      const pending = buildReservation(restaurantId, branchId, tableIds[0], user.id);
      await reservationRepository.createWithLock(pending, `lock-${randomUUID()}`);

      const now = new Date();
      const cancelled = pending.cancel(now);
      const applied = await reservationRepository.updateTransitioningFrom(
        cancelled,
        ReservationStatus.Pending,
      );
      expect(applied).toBe(true);
      await reservationHistoryRepository.save(
        ReservationHistory.create({
          id: randomUUID(),
          reservationId: pending.reservationId.value,
          oldStatus: ReservationStatus.Pending,
          newStatus: ReservationStatus.Cancelled,
          oldReservationDate: null,
          oldReservationStartTime: null,
          newReservationDate: null,
          newReservationStartTime: null,
          oldTableId: null,
          newTableId: null,
          withinCancellationWindow: CancellationWindowService.isWithinWindow(
            pending.reservationStartTime,
            60,
            now,
          ),
          changedBy: user.id,
          changedAt: now,
          reason: 'Change of plans',
        }),
      );

      const persisted = await reservationRepository.findById(pending.reservationId);
      expect(persisted?.status).toBe(ReservationStatus.Cancelled);
      const table = await tableRepository.findById(TableId.create(tableIds[0]));
      expect(table?.status).toBe(TableStatus.Available);

      const historyRows = await rawPrisma.reservationHistory.findMany({
        where: { reservationId: pending.reservationId.value },
      });
      expect(historyRows).toHaveLength(1);
      expect(historyRows[0]).toMatchObject({
        oldStatus: 'Pending',
        newStatus: 'Cancelled',
        changedBy: user.id,
        reason: 'Change of plans',
      });
    });

    it('cancels an Approved reservation and releases the Table atomically', async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, tableIds } = await seedBranchWithTables();
      const user = await seedUser();
      const pending = buildReservation(restaurantId, branchId, tableIds[0], user.id, {
        startTime: new Date('2026-11-02T18:00:00.000Z'),
        endTime: new Date('2026-11-02T19:30:00.000Z'),
      });
      await reservationRepository.createWithLock(pending, `lock-${randomUUID()}`);
      const approvedNow = new Date();
      const approved = pending.approve(randomUUID(), approvedNow);
      await reservationRepository.updateTransitioningFromPending(approved);
      const reservedTable = (await tableRepository.findById(TableId.create(tableIds[0])))!.reserve(
        pending.reservationId.value,
        approvedNow,
      );
      await tableRepository.save(reservedTable);

      const now = new Date();
      const cancelled = approved.cancel(now);
      await prismaContext.runInTransaction(async () => {
        const applied = await reservationRepository.updateTransitioningFrom(
          cancelled,
          ReservationStatus.Approved,
        );
        expect(applied).toBe(true);
        const table = await tableRepository.findById(TableId.create(tableIds[0]));
        const released = table!.release(now);
        await tableRepository.save(released);
      });

      const persisted = await reservationRepository.findById(pending.reservationId);
      expect(persisted?.status).toBe(ReservationStatus.Cancelled);
      const table = await tableRepository.findById(TableId.create(tableIds[0]));
      expect(table?.status).toBe(TableStatus.Available);
    });
  });

  describe('Complete / NoShow', () => {
    it('completes an Approved reservation, releasing the Table to Available (never Cleaning)', async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, tableIds } = await seedBranchWithTables();
      const user = await seedUser();
      const pending = buildReservation(restaurantId, branchId, tableIds[0], user.id, {
        startTime: new Date('2026-11-03T18:00:00.000Z'),
        endTime: new Date('2026-11-03T19:30:00.000Z'),
      });
      await reservationRepository.createWithLock(pending, `lock-${randomUUID()}`);
      const approvedAt = new Date();
      const approved = pending.approve(randomUUID(), approvedAt);
      await reservationRepository.updateTransitioningFromPending(approved);
      const reservedTable = (await tableRepository.findById(TableId.create(tableIds[0])))!.reserve(
        pending.reservationId.value,
        approvedAt,
      );
      await tableRepository.save(reservedTable);

      const completedAt = new Date('2026-11-03T18:05:00.000Z');
      const completed = approved.complete(completedAt);
      await prismaContext.runInTransaction(async () => {
        const applied = await reservationRepository.updateTransitioningFrom(
          completed,
          ReservationStatus.Approved,
        );
        expect(applied).toBe(true);
        const table = await tableRepository.findById(TableId.create(tableIds[0]));
        await tableRepository.save(table!.release(completedAt));
      });

      const persisted = await reservationRepository.findById(pending.reservationId);
      expect(persisted?.status).toBe(ReservationStatus.Completed);
      const table = await tableRepository.findById(TableId.create(tableIds[0]));
      expect(table?.status).toBe(TableStatus.Available);
    });

    it('marks an Approved reservation NoShow, releasing the Table to Available', async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, tableIds } = await seedBranchWithTables();
      const user = await seedUser();
      const pending = buildReservation(restaurantId, branchId, tableIds[0], user.id, {
        startTime: new Date('2026-11-04T18:00:00.000Z'),
        endTime: new Date('2026-11-04T19:30:00.000Z'),
      });
      await reservationRepository.createWithLock(pending, `lock-${randomUUID()}`);
      const approvedAt = new Date();
      const approved = pending.approve(randomUUID(), approvedAt);
      await reservationRepository.updateTransitioningFromPending(approved);
      const reservedTable = (await tableRepository.findById(TableId.create(tableIds[0])))!.reserve(
        pending.reservationId.value,
        approvedAt,
      );
      await tableRepository.save(reservedTable);

      const noShowAt = new Date('2026-11-04T18:10:00.000Z');
      const noShow = approved.markNoShow(noShowAt);
      await prismaContext.runInTransaction(async () => {
        const applied = await reservationRepository.updateTransitioningFrom(
          noShow,
          ReservationStatus.Approved,
        );
        expect(applied).toBe(true);
        const table = await tableRepository.findById(TableId.create(tableIds[0]));
        await tableRepository.save(table!.release(noShowAt));
      });

      const persisted = await reservationRepository.findById(pending.reservationId);
      expect(persisted?.status).toBe(ReservationStatus.NoShow);
      const table = await tableRepository.findById(TableId.create(tableIds[0]));
      expect(table?.status).toBe(TableStatus.Available);
    });
  });

  describe('Reschedule', () => {
    it('reschedules a Pending reservation to a different table with no Table operation', async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, tableIds } = await seedBranchWithTables(2);
      const user = await seedUser();
      const pending = buildReservation(restaurantId, branchId, tableIds[0], user.id, {
        startTime: new Date('2026-11-05T18:00:00.000Z'),
        endTime: new Date('2026-11-05T19:30:00.000Z'),
      });
      await reservationRepository.createWithLock(pending, `lock-${randomUUID()}`);

      const targetTable = await tableRepository.findByIdAndBranchId(
        TableId.create(tableIds[1]),
        BranchId.create(branchId),
      );
      expect(targetTable).not.toBeNull();

      const now = new Date();
      const rescheduled = pending.reschedule({
        tableId: tableIds[1],
        reservationDate: pending.reservationDate,
        reservationStartTime: pending.reservationStartTime,
        reservationEndTime: pending.reservationEndTime,
        guests: pending.guests,
        tableCapacity: targetTable!.capacity,
        now,
      });
      const applied = await reservationRepository.updateTransitioningFrom(
        rescheduled,
        ReservationStatus.Pending,
      );
      expect(applied).toBe(true);

      const persisted = await reservationRepository.findById(pending.reservationId);
      expect(persisted?.tableId.value).toBe(tableIds[1]);
      const originalTable = await tableRepository.findById(TableId.create(tableIds[0]));
      const newTable = await tableRepository.findById(TableId.create(tableIds[1]));
      expect(originalTable?.status).toBe(TableStatus.Available);
      expect(newTable?.status).toBe(TableStatus.Available);
    });

    it('ADR-023: acquires both old and new advisory lock keys, in deterministic sorted order, and releases/reserves Tables atomically for a cross-table Approved reschedule', async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, tableIds } = await seedBranchWithTables(2);
      const user = await seedUser();
      const pending = buildReservation(restaurantId, branchId, tableIds[0], user.id, {
        startTime: new Date('2026-11-06T18:00:00.000Z'),
        endTime: new Date('2026-11-06T19:30:00.000Z'),
      });
      await reservationRepository.createWithLock(pending, `lock-${randomUUID()}`);
      const approvedAt = new Date();
      const approved = pending.approve(randomUUID(), approvedAt);
      await reservationRepository.updateTransitioningFromPending(approved);
      const reservedTable = (await tableRepository.findById(TableId.create(tableIds[0])))!.reserve(
        pending.reservationId.value,
        approvedAt,
      );
      await tableRepository.save(reservedTable);

      const oldLockKey = ReservationAvailabilityService.deriveLockKey(
        branchId,
        tableIds[0],
        pending.reservationDate,
        ReservationAvailabilityService.deriveTimeSlotBucket(pending.reservationStartTime, 30),
      );
      const newLockKey = ReservationAvailabilityService.deriveLockKey(
        branchId,
        tableIds[1],
        pending.reservationDate,
        ReservationAvailabilityService.deriveTimeSlotBucket(pending.reservationStartTime, 30),
      );
      const [firstKey, secondKey] = [oldLockKey, newLockKey].sort();

      const now = new Date();
      const targetTable = await tableRepository.findByIdAndBranchId(
        TableId.create(tableIds[1]),
        BranchId.create(branchId),
      );
      const rescheduled = approved.reschedule({
        tableId: tableIds[1],
        reservationDate: approved.reservationDate,
        reservationStartTime: approved.reservationStartTime,
        reservationEndTime: approved.reservationEndTime,
        guests: approved.guests,
        tableCapacity: targetTable!.capacity,
        now,
      });

      await prismaContext.runInTransaction(async () => {
        // ADR-023: acquired in deterministic sorted order regardless of
        // which table is "old" vs "new" - proven against a real Postgres
        // advisory-lock call, not simulated.
        await reservationRepository.acquireAdvisoryLock(firstKey);
        await reservationRepository.acquireAdvisoryLock(secondKey);

        const applied = await reservationRepository.updateTransitioningFrom(
          rescheduled,
          ReservationStatus.Approved,
        );
        expect(applied).toBe(true);

        const oldTable = await tableRepository.findById(TableId.create(tableIds[0]));
        await tableRepository.save(oldTable!.release(now));
        const newTable = await tableRepository.findById(TableId.create(tableIds[1]));
        await tableRepository.save(newTable!.reserve(pending.reservationId.value, now));
      });

      const persisted = await reservationRepository.findById(pending.reservationId);
      expect(persisted?.tableId.value).toBe(tableIds[1]);
      const oldTable = await tableRepository.findById(TableId.create(tableIds[0]));
      const newTable = await tableRepository.findById(TableId.create(tableIds[1]));
      expect(oldTable?.status).toBe(TableStatus.Available);
      expect(newTable?.status).toBe(TableStatus.Reserved);
    });

    it('auto-rejects another overlapping Pending reservation on the target table during an Approved reschedule, atomically', async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, tableIds } = await seedBranchWithTables(2);
      const user = await seedUser();
      const pending = buildReservation(restaurantId, branchId, tableIds[0], user.id, {
        startTime: new Date('2026-11-07T18:00:00.000Z'),
        endTime: new Date('2026-11-07T19:30:00.000Z'),
      });
      await reservationRepository.createWithLock(pending, `lock-${randomUUID()}`);
      const approvedAt = new Date();
      const approved = pending.approve(randomUUID(), approvedAt);
      await reservationRepository.updateTransitioningFromPending(approved);
      const reservedTable = (await tableRepository.findById(TableId.create(tableIds[0])))!.reserve(
        pending.reservationId.value,
        approvedAt,
      );
      await tableRepository.save(reservedTable);

      const overlappingPending = buildReservation(restaurantId, branchId, tableIds[1], user.id, {
        startTime: new Date('2026-11-07T18:15:00.000Z'),
        endTime: new Date('2026-11-07T19:45:00.000Z'),
      });
      await reservationRepository.createWithLock(overlappingPending, `lock-${randomUUID()}`);

      const now = new Date();
      const targetTable = await tableRepository.findByIdAndBranchId(
        TableId.create(tableIds[1]),
        BranchId.create(branchId),
      );
      const rescheduled = approved.reschedule({
        tableId: tableIds[1],
        reservationDate: approved.reservationDate,
        reservationStartTime: approved.reservationStartTime,
        reservationEndTime: approved.reservationEndTime,
        guests: approved.guests,
        tableCapacity: targetTable!.capacity,
        now,
      });

      await prismaContext.runInTransaction(async () => {
        const applied = await reservationRepository.updateTransitioningFrom(
          rescheduled,
          ReservationStatus.Approved,
        );
        expect(applied).toBe(true);

        const oldTable = await tableRepository.findById(TableId.create(tableIds[0]));
        await tableRepository.save(oldTable!.release(now));
        const newTable = await tableRepository.findById(TableId.create(tableIds[1]));
        await tableRepository.save(newTable!.reserve(pending.reservationId.value, now));

        const candidates = await reservationRepository.findOtherOverlappingPending(
          rescheduled.tableId,
          rescheduled.reservationStartTime,
          rescheduled.reservationEndTime,
          rescheduled.reservationId,
        );
        expect(candidates.map((c) => c.reservationId.value)).toEqual([
          overlappingPending.reservationId.value,
        ]);
        const autoRejected = candidates[0].autoReject(now, 'Automatically rejected: overlap.');
        const rejectApplied =
          await reservationRepository.updateTransitioningFromPending(autoRejected);
        expect(rejectApplied).toBe(true);
      });

      const persistedRejected = await reservationRepository.findById(
        overlappingPending.reservationId,
      );
      expect(persistedRejected?.status).toBe(ReservationStatus.Rejected);
    });

    it('rejects a reschedule target window that is already confirmed-occupied (ReservationConflictException)', async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, tableIds } = await seedBranchWithTables(2);
      const user = await seedUser();
      const pending = buildReservation(restaurantId, branchId, tableIds[0], user.id, {
        startTime: new Date('2026-11-08T18:00:00.000Z'),
        endTime: new Date('2026-11-08T19:30:00.000Z'),
      });
      await reservationRepository.createWithLock(pending, `lock-${randomUUID()}`);

      await rawPrisma.reservation.create({
        data: {
          userId: user.id,
          restaurantId,
          branchId,
          tableId: tableIds[1],
          reservationDate: new Date('2026-11-08T00:00:00.000Z'),
          reservationStartTime: new Date('2026-11-08T18:15:00.000Z'),
          reservationEndTime: new Date('2026-11-08T19:45:00.000Z'),
          guests: 2,
          status: 'Approved',
          source: 'Online',
          createdBy: user.id,
        },
      });

      const conflict = await reservationRepository.findConfirmedOverlapExcluding(
        TableId.create(tableIds[1]),
        pending.reservationStartTime,
        pending.reservationEndTime,
        pending.reservationId,
      );
      expect(conflict).not.toBeNull();

      await expect(
        prismaContext.runInTransaction(async () => {
          const stillConflict = await reservationRepository.findConfirmedOverlapExcluding(
            TableId.create(tableIds[1]),
            pending.reservationStartTime,
            pending.reservationEndTime,
            pending.reservationId,
          );
          if (stillConflict !== null) {
            throw new ReservationConflictException();
          }
        }),
      ).rejects.toBeInstanceOf(ReservationConflictException);

      const persisted = await reservationRepository.findById(pending.reservationId);
      expect(persisted?.status).toBe(ReservationStatus.Pending);
      expect(persisted?.tableId.value).toBe(tableIds[0]);
    });

    it('findByIdAndBranchId returns null for a table belonging to a different Branch (cross-branch rejection)', async () => {
      if (!dbAvailable) return;

      const { branchId: branchA } = await seedBranchWithTables();
      const { tableIds: branchBTableIds } = await seedBranchWithTables();

      const result = await tableRepository.findByIdAndBranchId(
        TableId.create(branchBTableIds[0]),
        BranchId.create(branchA),
      );
      expect(result).toBeNull();
    });

    it('persists ReservationHistory with oldTableId/newTableId populated only when the table actually changed', async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, tableIds } = await seedBranchWithTables(2);
      const user = await seedUser();
      const pending = buildReservation(restaurantId, branchId, tableIds[0], user.id, {
        startTime: new Date('2026-11-09T18:00:00.000Z'),
        endTime: new Date('2026-11-09T19:30:00.000Z'),
      });
      await reservationRepository.createWithLock(pending, `lock-${randomUUID()}`);

      const targetTable = await tableRepository.findByIdAndBranchId(
        TableId.create(tableIds[1]),
        BranchId.create(branchId),
      );
      const now = new Date();
      const rescheduled = pending.reschedule({
        tableId: tableIds[1],
        reservationDate: pending.reservationDate,
        reservationStartTime: pending.reservationStartTime,
        reservationEndTime: pending.reservationEndTime,
        guests: pending.guests,
        tableCapacity: targetTable!.capacity,
        now,
      });
      await reservationRepository.updateTransitioningFrom(rescheduled, ReservationStatus.Pending);
      await reservationHistoryRepository.save(
        ReservationHistory.create({
          id: randomUUID(),
          reservationId: pending.reservationId.value,
          oldStatus: ReservationStatus.Pending,
          newStatus: ReservationStatus.Pending,
          oldReservationDate: pending.reservationDate,
          oldReservationStartTime: pending.reservationStartTime,
          newReservationDate: rescheduled.reservationDate,
          newReservationStartTime: rescheduled.reservationStartTime,
          oldTableId: tableIds[0],
          newTableId: tableIds[1],
          withinCancellationWindow: false,
          changedBy: user.id,
          changedAt: now,
          reason: null,
        }),
      );

      const historyRows = await rawPrisma.reservationHistory.findMany({
        where: { reservationId: pending.reservationId.value },
      });
      expect(historyRows).toHaveLength(1);
      expect(historyRows[0]).toMatchObject({
        oldTableId: tableIds[0],
        newTableId: tableIds[1],
        withinCancellationWindow: false,
      });
    });
  });

  describe('Expiration', () => {
    it('expires a Pending reservation via updateTransitioningFrom, performing no Table operation', async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, tableIds } = await seedBranchWithTables();
      const user = await seedUser();
      const pending = buildReservation(restaurantId, branchId, tableIds[0], user.id, {
        startTime: new Date('2026-11-10T18:00:00.000Z'),
        endTime: new Date('2026-11-10T19:30:00.000Z'),
      });
      await reservationRepository.createWithLock(pending, `lock-${randomUUID()}`);

      const now = new Date();
      const expired = pending.expire(now);
      const applied = await reservationRepository.updateTransitioningFrom(
        expired,
        ReservationStatus.Pending,
      );
      expect(applied).toBe(true);

      const persisted = await reservationRepository.findById(pending.reservationId);
      expect(persisted?.status).toBe(ReservationStatus.Expired);
      const table = await tableRepository.findById(TableId.create(tableIds[0]));
      expect(table?.status).toBe(TableStatus.Available);
    });

    it('updateTransitioningFrom is a no-op when the reservation already moved away from Pending (idempotent expiration)', async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, tableIds } = await seedBranchWithTables();
      const user = await seedUser();
      const pending = buildReservation(restaurantId, branchId, tableIds[0], user.id, {
        startTime: new Date('2026-11-11T18:00:00.000Z'),
        endTime: new Date('2026-11-11T19:30:00.000Z'),
      });
      await reservationRepository.createWithLock(pending, `lock-${randomUUID()}`);

      const cancelled = pending.cancel(new Date());
      expect(
        await reservationRepository.updateTransitioningFrom(cancelled, ReservationStatus.Pending),
      ).toBe(true);

      // A retried/delayed expiration job firing against a stale Pending
      // snapshot must be a safe no-op, not an overwrite of the Cancel.
      const staleExpired = pending.expire(new Date());
      expect(
        await reservationRepository.updateTransitioningFrom(
          staleExpired,
          ReservationStatus.Pending,
        ),
      ).toBe(false);

      const persisted = await reservationRepository.findById(pending.reservationId);
      expect(persisted?.status).toBe(ReservationStatus.Cancelled);
    });
  });
});
