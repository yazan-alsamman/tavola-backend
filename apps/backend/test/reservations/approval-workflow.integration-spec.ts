import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { PrismaReservationRepository } from '@modules/reservations/infrastructure/persistence/prisma-reservation.repository';
import { PrismaTableRepository } from '@modules/tables/infrastructure/persistence/prisma-table.repository';
import { Reservation } from '@modules/reservations/domain/entities/reservation.entity';
import { ReservationStatus } from '@modules/reservations/domain/enums/reservation.enums';
import { ReservationConflictException } from '@modules/reservations/domain/exceptions/reservation-conflict.exception';
import { ReservationAvailabilityService } from '@modules/reservations/domain/services/reservation-availability.service';
import { TableStatus } from '@modules/tables/domain/enums/table.enums';
import { TableId } from '@shared/domain/value-objects/identifiers.vo';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'reservation-approval-';

/**
 * Phase 7.2 (Approval Workflow) - integration coverage against real
 * PostgreSQL for the repository-level building blocks
 * `ApproveReservationUseCase`/`RejectReservationUseCase`/the auto-approval
 * branch of `CreateReservationUseCase` orchestrate: the ADR-013 advisory
 * lock at Approval time (not just Create), the conditional
 * `WHERE status = 'Pending'` optimistic-locking update, cross-aggregate
 * atomicity (Reservation + Table) via `PrismaContext.runInTransaction`, and
 * `TableStatus.Reserved` persistence.
 */
describe('Phase 7.2 Approval Workflow - PrismaReservationRepository + PrismaTableRepository (integration)', () => {
  let dbAvailable = false;
  let reservationRepository: PrismaReservationRepository;
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
      PrismaTableRepository,
    ]);
    reservationRepository = moduleRef.get(PrismaReservationRepository);
    tableRepository = moduleRef.get(PrismaTableRepository);
    prismaContext = moduleRef.get(PrismaContext);

    org = await rawPrisma.organization.create({
      data: {
        name: 'Reservation Approval Test Org',
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
    await rawPrisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
    await rawPrisma.organization.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.$disconnect();
  });

  async function seedRestaurantBranchTable(): Promise<{
    restaurantId: string;
    branchId: string;
    tableId: string;
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
    const table = await rawPrisma.table.create({
      data: {
        branchId: branch.id,
        floorPlanId: floorPlan.id,
        tableNumber: 'T1',
        capacity: 4,
      },
    });
    return { restaurantId: restaurant.id, branchId: branch.id, tableId: table.id };
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

  function buildPendingReservation(
    restaurantId: string,
    branchId: string,
    tableId: string,
    userId: string,
    overrides: Partial<{ id: string; startTime: Date; endTime: Date }> = {},
  ): Reservation {
    const now = new Date();
    const startTime = overrides.startTime ?? new Date('2026-10-01T18:00:00.000Z');
    const endTime = overrides.endTime ?? new Date('2026-10-01T19:30:00.000Z');
    return Reservation.create({
      id: overrides.id ?? randomUUID(),
      userId,
      restaurantId,
      branchId,
      tableId,
      reservationDate: new Date('2026-10-01T00:00:00.000Z'),
      reservationStartTime: startTime,
      reservationEndTime: endTime,
      guests: 2,
      tableCapacity: 4,
      notes: null,
      createdBy: userId,
      now,
    });
  }

  it('approves a Pending reservation and reserves the table atomically in one transaction', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
    const user = await seedUser();
    const pending = buildPendingReservation(restaurantId, branchId, tableId, user.id);
    const lockKey = ReservationAvailabilityService.deriveLockKey(
      branchId,
      tableId,
      pending.reservationDate,
      ReservationAvailabilityService.deriveTimeSlotBucket(pending.reservationStartTime, 30),
    );
    await reservationRepository.createWithLock(pending, lockKey);

    const now = new Date();
    const approved = pending.approve(randomUUID(), now);

    await prismaContext.runInTransaction(async () => {
      await reservationRepository.acquireAdvisoryLock(lockKey);
      const conflict = await reservationRepository.findConfirmedOverlapExcluding(
        pending.tableId,
        pending.reservationStartTime,
        pending.reservationEndTime,
        pending.reservationId,
      );
      expect(conflict).toBeNull();

      const applied = await reservationRepository.updateTransitioningFromPending(approved);
      expect(applied).toBe(true);

      const table = await tableRepository.findById(TableId.create(tableId));
      const reservedTable = table!.reserve(pending.reservationId.value, now);
      await tableRepository.save(reservedTable);
    });

    const persistedReservation = await reservationRepository.findById(pending.reservationId);
    expect(persistedReservation?.status).toBe(ReservationStatus.Approved);
    expect(persistedReservation?.approvedBy).toBe(approved.approvedBy);

    const persistedTable = await tableRepository.findById(TableId.create(tableId));
    expect(persistedTable?.status).toBe(TableStatus.Reserved);
  });

  it('rolls back both the reservation and the table if Table.reserve() fails mid-transaction (no partial state)', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
    const user = await seedUser();
    // Force the table into Occupied first, so Table.reserve() throws inside
    // the transaction (only an Available table may be reserved).
    await rawPrisma.table.update({ where: { id: tableId }, data: { status: 'Occupied' } });

    const pending = buildPendingReservation(restaurantId, branchId, tableId, user.id);
    const lockKey = ReservationAvailabilityService.deriveLockKey(
      branchId,
      tableId,
      pending.reservationDate,
      ReservationAvailabilityService.deriveTimeSlotBucket(pending.reservationStartTime, 30),
    );
    await reservationRepository.createWithLock(pending, lockKey);

    const now = new Date();
    const approved = pending.approve(randomUUID(), now);

    await expect(
      prismaContext.runInTransaction(async () => {
        await reservationRepository.acquireAdvisoryLock(lockKey);
        await reservationRepository.updateTransitioningFromPending(approved);

        const table = await tableRepository.findById(TableId.create(tableId));
        // Table is Occupied - reserve() throws, rolling back the whole transaction.
        const reservedTable = table!.reserve(pending.reservationId.value, now);
        await tableRepository.save(reservedTable);
      }),
    ).rejects.toThrow();

    const persistedReservation = await reservationRepository.findById(pending.reservationId);
    expect(persistedReservation?.status).toBe(ReservationStatus.Pending);

    const persistedTable = await tableRepository.findById(TableId.create(tableId));
    expect(persistedTable?.status).toBe(TableStatus.Occupied);
  });

  it('rejects a Pending reservation without any Table operation', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
    const user = await seedUser();
    const pending = buildPendingReservation(restaurantId, branchId, tableId, user.id);
    await reservationRepository.createWithLock(
      pending,
      ReservationAvailabilityService.deriveLockKey(branchId, tableId, pending.reservationDate, 36),
    );

    const rejected = pending.reject(new Date());
    const applied = await reservationRepository.updateTransitioningFromPending(rejected);
    expect(applied).toBe(true);

    const persisted = await reservationRepository.findById(pending.reservationId);
    expect(persisted?.status).toBe(ReservationStatus.Rejected);

    const table = await tableRepository.findById(TableId.create(tableId));
    expect(table?.status).toBe(TableStatus.Available);
  });

  it('auto-rejects an overlapping Pending reservation with a system note, leaving the Table untouched', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
    const user = await seedUser();
    const approvedTarget = buildPendingReservation(restaurantId, branchId, tableId, user.id, {
      startTime: new Date('2026-10-02T18:00:00.000Z'),
      endTime: new Date('2026-10-02T19:30:00.000Z'),
    });
    const overlappingPending = buildPendingReservation(restaurantId, branchId, tableId, user.id, {
      startTime: new Date('2026-10-02T18:30:00.000Z'),
      endTime: new Date('2026-10-02T20:00:00.000Z'),
    });
    await reservationRepository.createWithLock(approvedTarget, `lock-${randomUUID()}`);
    await reservationRepository.createWithLock(overlappingPending, `lock-${randomUUID()}`);

    const candidates = await reservationRepository.findOtherOverlappingPending(
      approvedTarget.tableId,
      approvedTarget.reservationStartTime,
      approvedTarget.reservationEndTime,
      approvedTarget.reservationId,
    );
    expect(candidates.map((c) => c.reservationId.value)).toEqual([
      overlappingPending.reservationId.value,
    ]);

    const now = new Date();
    const autoRejected = candidates[0].autoReject(now, 'Automatically rejected: overlap.');
    const applied = await reservationRepository.updateTransitioningFromPending(autoRejected);
    expect(applied).toBe(true);

    const persisted = await reservationRepository.findById(overlappingPending.reservationId);
    expect(persisted?.status).toBe(ReservationStatus.Rejected);
    expect(persisted?.notes).toBe('Automatically rejected: overlap.');

    const table = await tableRepository.findById(TableId.create(tableId));
    expect(table?.status).toBe(TableStatus.Available);
  });

  it('updateTransitioningFromPending returns false (no-op) when the row already moved away from Pending', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
    const user = await seedUser();
    const pending = buildPendingReservation(restaurantId, branchId, tableId, user.id);
    await reservationRepository.createWithLock(
      pending,
      ReservationAvailabilityService.deriveLockKey(branchId, tableId, pending.reservationDate, 36),
    );

    // First transition wins.
    const rejected = pending.reject(new Date());
    expect(await reservationRepository.updateTransitioningFromPending(rejected)).toBe(true);

    // A second, concurrent attempt against the same stale Pending snapshot
    // (e.g. a racing Approve) must be a no-op, not an overwrite.
    const staleApproval = pending.approve(randomUUID(), new Date());
    expect(await reservationRepository.updateTransitioningFromPending(staleApproval)).toBe(false);

    const persisted = await reservationRepository.findById(pending.reservationId);
    expect(persisted?.status).toBe(ReservationStatus.Rejected);
  });

  it('ADR-013: Approval-time advisory lock + confirmed-overlap re-check rejects an Approve when a confirmed reservation already overlaps', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
    const user = await seedUser();
    const pending = buildPendingReservation(restaurantId, branchId, tableId, user.id, {
      startTime: new Date('2026-10-03T18:00:00.000Z'),
      endTime: new Date('2026-10-03T19:30:00.000Z'),
    });
    await reservationRepository.createWithLock(pending, `lock-${randomUUID()}`);

    // A confirmed (Approved) reservation now overlaps the same table/window
    // - e.g. auto-approved for a different, overlapping request after
    // `pending` was created.
    await rawPrisma.reservation.create({
      data: {
        userId: user.id,
        restaurantId,
        branchId,
        tableId,
        reservationDate: new Date('2026-10-03T00:00:00.000Z'),
        reservationStartTime: new Date('2026-10-03T18:15:00.000Z'),
        reservationEndTime: new Date('2026-10-03T19:45:00.000Z'),
        guests: 2,
        status: 'Approved',
        source: 'Online',
        createdBy: user.id,
      },
    });

    const lockKey = ReservationAvailabilityService.deriveLockKey(
      branchId,
      tableId,
      pending.reservationDate,
      ReservationAvailabilityService.deriveTimeSlotBucket(pending.reservationStartTime, 30),
    );

    await expect(
      prismaContext.runInTransaction(async () => {
        await reservationRepository.acquireAdvisoryLock(lockKey);
        const conflict = await reservationRepository.findConfirmedOverlapExcluding(
          pending.tableId,
          pending.reservationStartTime,
          pending.reservationEndTime,
          pending.reservationId,
        );
        if (conflict !== null) {
          throw new ReservationConflictException();
        }
      }),
    ).rejects.toBeInstanceOf(ReservationConflictException);

    // The Pending reservation must remain untouched - Approval never applied.
    const persisted = await reservationRepository.findById(pending.reservationId);
    expect(persisted?.status).toBe(ReservationStatus.Pending);
  });

  it('updateTransitioningFromPending maps a database-level exclusion-constraint violation to ReservationConflictException', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
    const user = await seedUser();
    const pending = buildPendingReservation(restaurantId, branchId, tableId, user.id, {
      startTime: new Date('2026-10-04T18:00:00.000Z'),
      endTime: new Date('2026-10-04T19:30:00.000Z'),
    });
    await reservationRepository.createWithLock(pending, `lock-${randomUUID()}`);

    // Seed a real, already-committed Approved row overlapping the same
    // table/window - bypassing the pre-check, exactly like the Phase 7.1
    // integration spec's own "createWithLock catches a real database-level
    // exclusion-constraint violation" test simulates for Create.
    await rawPrisma.reservation.create({
      data: {
        userId: user.id,
        restaurantId,
        branchId,
        tableId,
        reservationDate: new Date('2026-10-04T00:00:00.000Z'),
        reservationStartTime: new Date('2026-10-04T18:15:00.000Z'),
        reservationEndTime: new Date('2026-10-04T19:45:00.000Z'),
        guests: 2,
        status: 'Approved',
        source: 'Online',
        createdBy: user.id,
      },
    });

    // Attempt the conditional UPDATE directly (bypassing the application-level
    // pre-check `findConfirmedOverlapExcluding`) - the database's own
    // exclusion constraint must still reject it, and the repository must map
    // that to ReservationConflictException, not a raw Prisma error.
    const approved = pending.approve(randomUUID(), new Date());
    await expect(
      reservationRepository.updateTransitioningFromPending(approved),
    ).rejects.toBeInstanceOf(ReservationConflictException);

    // The row itself must remain Pending - Postgres rejected the UPDATE.
    const persisted = await reservationRepository.findById(pending.reservationId);
    expect(persisted?.status).toBe(ReservationStatus.Pending);
  });

  it('auto-approval: createWithLockInTransaction + Table.reserve() commit atomically inside one UnitOfWork transaction', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
    const user = await seedUser();
    const now = new Date();
    const autoApproved = Reservation.createAutoApproved({
      id: randomUUID(),
      userId: user.id,
      restaurantId,
      branchId,
      tableId,
      reservationDate: new Date('2026-10-05T00:00:00.000Z'),
      reservationStartTime: new Date('2026-10-05T18:00:00.000Z'),
      reservationEndTime: new Date('2026-10-05T19:30:00.000Z'),
      guests: 2,
      tableCapacity: 4,
      notes: null,
      createdBy: user.id,
      now,
    });
    const lockKey = ReservationAvailabilityService.deriveLockKey(
      branchId,
      tableId,
      autoApproved.reservationDate,
      ReservationAvailabilityService.deriveTimeSlotBucket(autoApproved.reservationStartTime, 30),
    );

    await prismaContext.runInTransaction(async () => {
      await reservationRepository.createWithLockInTransaction(autoApproved, lockKey);
      const table = await tableRepository.findById(TableId.create(tableId));
      const reservedTable = table!.reserve(autoApproved.reservationId.value, now);
      await tableRepository.save(reservedTable);
    });

    const persistedReservation = await reservationRepository.findById(autoApproved.reservationId);
    expect(persistedReservation?.status).toBe(ReservationStatus.Approved);
    expect(persistedReservation?.approvedBy).toBeNull();

    const persistedTable = await tableRepository.findById(TableId.create(tableId));
    expect(persistedTable?.status).toBe(TableStatus.Reserved);
  });

  it('TableStatus.Reserved round-trips correctly through the Prisma mapper', async () => {
    if (!dbAvailable) return;

    const { tableId } = await seedRestaurantBranchTable();
    const table = await tableRepository.findById(TableId.create(tableId));
    const reserved = table!.reserve(randomUUID(), new Date());
    await tableRepository.save(reserved);

    const reloaded = await tableRepository.findById(TableId.create(tableId));
    expect(reloaded?.status).toBe(TableStatus.Reserved);

    const released = reloaded!.release(new Date());
    await tableRepository.save(released);
    const reloadedAgain = await tableRepository.findById(TableId.create(tableId));
    expect(reloadedAgain?.status).toBe(TableStatus.Available);
  });
});
