import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaReservationRepository } from '@modules/reservations/infrastructure/persistence/prisma-reservation.repository';
import { Reservation } from '@modules/reservations/domain/entities/reservation.entity';
import {
  ReservationSource,
  ReservationStatus,
} from '@modules/reservations/domain/enums/reservation.enums';
import { ReservationConflictException } from '@modules/reservations/domain/exceptions/reservation-conflict.exception';
import { ReservationAvailabilityService } from '@modules/reservations/domain/services/reservation-availability.service';
import { ReservationId, TableId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'reservation-repo-';

describe('Reservation round-trip via PrismaReservationRepository (integration)', () => {
  let dbAvailable = false;
  let repository: PrismaReservationRepository;
  let org: { id: string };

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([PrismaReservationRepository]);
    repository = moduleRef.get(PrismaReservationRepository);

    org = await rawPrisma.organization.create({
      data: {
        name: 'Reservation Repo Test Org',
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

  function buildReservation(
    restaurantId: string,
    branchId: string,
    tableId: string,
    userId: string,
    overrides: Partial<{ startTime: Date; endTime: Date }> = {},
  ): Reservation {
    const now = new Date();
    const startTime = overrides.startTime ?? new Date('2026-09-01T18:00:00.000Z');
    const endTime = overrides.endTime ?? new Date('2026-09-01T19:30:00.000Z');
    return Reservation.create({
      id: randomUUID(),
      userId,
      reservationGuestId: null,
      source: ReservationSource.Online,
      restaurantId,
      branchId,
      tableId,
      reservationDate: new Date('2026-09-01T00:00:00.000Z'),
      reservationStartTime: startTime,
      reservationEndTime: endTime,
      guests: 2,
      tableCapacity: 4,
      notes: null,
      createdBy: userId,
      now,
    });
  }

  it('createWithLock persists a reservation, findOverlappingPendingOrApproved finds it', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
    const user = await seedUser();
    const reservation = buildReservation(restaurantId, branchId, tableId, user.id);
    const lockKey = ReservationAvailabilityService.deriveLockKey(
      branchId,
      tableId,
      reservation.reservationDate,
      ReservationAvailabilityService.deriveTimeSlotBucket(reservation.reservationStartTime, 30),
    );

    await repository.createWithLock(reservation, lockKey);

    const overlapping = await repository.findOverlappingPendingOrApproved(
      TableId.create(tableId),
      new Date('2026-09-01T18:30:00.000Z'),
      new Date('2026-09-01T20:00:00.000Z'),
    );
    expect(overlapping).toHaveLength(1);
    expect(overlapping[0].reservationId.value).toBe(reservation.reservationId.value);
  });

  it('hasOpenReservationsByUserId (Phase 20.X, account deletion gate) returns true for a Pending reservation not yet ended', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
    const user = await seedUser();
    const reservation = buildReservation(restaurantId, branchId, tableId, user.id, {
      startTime: new Date('2026-09-04T18:00:00.000Z'),
      endTime: new Date('2026-09-04T19:30:00.000Z'),
    });
    await repository.createWithLock(reservation, `lock-${randomUUID()}`);

    const hasOpen = await repository.hasOpenReservationsByUserId(
      UserId.create(user.id),
      new Date('2026-09-01T00:00:00.000Z'),
    );

    expect(hasOpen).toBe(true);
  });

  it('hasOpenReservationsByUserId returns true for an Approved reservation not yet ended', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
    const user = await seedUser();
    const reservation = buildReservation(restaurantId, branchId, tableId, user.id, {
      startTime: new Date('2026-09-05T18:00:00.000Z'),
      endTime: new Date('2026-09-05T19:30:00.000Z'),
    });
    await repository.createWithLock(reservation, `lock-${randomUUID()}`);
    await rawPrisma.reservation.update({
      where: { id: reservation.reservationId.value },
      data: { status: 'Approved' },
    });

    const hasOpen = await repository.hasOpenReservationsByUserId(
      UserId.create(user.id),
      new Date('2026-09-01T00:00:00.000Z'),
    );

    expect(hasOpen).toBe(true);
  });

  it('hasOpenReservationsByUserId returns false once the reservation has ended, and false for Cancelled/Completed/NoShow', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
    const user = await seedUser();
    const pastReservation = buildReservation(restaurantId, branchId, tableId, user.id, {
      startTime: new Date('2026-09-06T18:00:00.000Z'),
      endTime: new Date('2026-09-06T19:30:00.000Z'),
    });
    await repository.createWithLock(pastReservation, `lock-${randomUUID()}`);

    const hasOpenAfterEnd = await repository.hasOpenReservationsByUserId(
      UserId.create(user.id),
      new Date('2026-09-07T00:00:00.000Z'),
    );
    expect(hasOpenAfterEnd).toBe(false);

    await rawPrisma.reservation.update({
      where: { id: pastReservation.reservationId.value },
      data: { status: 'Cancelled' },
    });
    const hasOpenCancelled = await repository.hasOpenReservationsByUserId(
      UserId.create(user.id),
      new Date('2026-09-01T00:00:00.000Z'),
    );
    expect(hasOpenCancelled).toBe(false);
  });

  it('hasOpenReservationsByUserId is scoped to the given user only', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
    const userA = await seedUser();
    const userB = await seedUser();
    const reservation = buildReservation(restaurantId, branchId, tableId, userA.id, {
      startTime: new Date('2026-09-08T18:00:00.000Z'),
      endTime: new Date('2026-09-08T19:30:00.000Z'),
    });
    await repository.createWithLock(reservation, `lock-${randomUUID()}`);

    expect(
      await repository.hasOpenReservationsByUserId(
        UserId.create(userA.id),
        new Date('2026-09-01T00:00:00.000Z'),
      ),
    ).toBe(true);
    expect(
      await repository.hasOpenReservationsByUserId(
        UserId.create(userB.id),
        new Date('2026-09-01T00:00:00.000Z'),
      ),
    ).toBe(false);
  });

  it('two overlapping Pending reservations for the same table both persist (business rule)', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
    const user = await seedUser();
    const first = buildReservation(restaurantId, branchId, tableId, user.id, {
      startTime: new Date('2026-09-02T18:00:00.000Z'),
      endTime: new Date('2026-09-02T19:30:00.000Z'),
    });
    const second = buildReservation(restaurantId, branchId, tableId, user.id, {
      startTime: new Date('2026-09-02T18:15:00.000Z'),
      endTime: new Date('2026-09-02T19:45:00.000Z'),
    });

    await repository.createWithLock(first, `lock-${randomUUID()}`);
    await expect(
      repository.createWithLock(second, `lock-${randomUUID()}`),
    ).resolves.toBeUndefined();
  });

  it('ADR-013 exclusion constraint rejects two overlapping confirmed (Approved) rows at the database level', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
    const user = await seedUser();

    await rawPrisma.reservation.create({
      data: {
        userId: user.id,
        restaurantId,
        branchId,
        tableId,
        reservationDate: new Date('2026-09-03T00:00:00.000Z'),
        reservationStartTime: new Date('2026-09-03T18:00:00.000Z'),
        reservationEndTime: new Date('2026-09-03T19:30:00.000Z'),
        guests: 2,
        status: 'Approved',
        source: 'Online',
        createdBy: user.id,
      },
    });

    await expect(
      rawPrisma.reservation.create({
        data: {
          userId: user.id,
          restaurantId,
          branchId,
          tableId,
          reservationDate: new Date('2026-09-03T00:00:00.000Z'),
          reservationStartTime: new Date('2026-09-03T18:30:00.000Z'),
          reservationEndTime: new Date('2026-09-03T20:00:00.000Z'),
          guests: 2,
          status: 'Approved',
          source: 'Online',
          createdBy: user.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('createWithLock throws ReservationConflictException when a confirmed reservation already overlaps', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
    const user = await seedUser();

    await rawPrisma.reservation.create({
      data: {
        userId: user.id,
        restaurantId,
        branchId,
        tableId,
        reservationDate: new Date('2026-09-04T00:00:00.000Z'),
        reservationStartTime: new Date('2026-09-04T18:00:00.000Z'),
        reservationEndTime: new Date('2026-09-04T19:30:00.000Z'),
        guests: 2,
        status: 'Approved',
        source: 'Online',
        createdBy: user.id,
      },
    });

    const conflicting = buildReservation(restaurantId, branchId, tableId, user.id, {
      startTime: new Date('2026-09-04T18:30:00.000Z'),
      endTime: new Date('2026-09-04T20:00:00.000Z'),
    });

    await expect(
      repository.createWithLock(conflicting, `lock-${randomUUID()}`),
    ).rejects.toBeInstanceOf(ReservationConflictException);
  });

  it('ADR-013: createWithLock catches a real database-level exclusion-constraint violation and maps it to ReservationConflictException, not a raw Prisma error', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
    const user = await seedUser();

    // Seed a real, already-committed Approved reservation directly (bypassing
    // the repository), the same way the existing "exclusion constraint
    // rejects... at the database level" test above does.
    await rawPrisma.reservation.create({
      data: {
        userId: user.id,
        restaurantId,
        branchId,
        tableId,
        reservationDate: new Date('2026-09-06T00:00:00.000Z'),
        reservationStartTime: new Date('2026-09-06T18:00:00.000Z'),
        reservationEndTime: new Date('2026-09-06T19:30:00.000Z'),
        guests: 2,
        status: 'Approved',
        source: 'Online',
        createdBy: user.id,
      },
    });

    // Reconstituted directly as `Approved` - `Reservation.create()` (used by
    // `buildReservation`) only ever produces `Pending` (Phase 7.1 Scope
    // Amendment), and `Pending` never violates the exclusion constraint by
    // design (see the "two overlapping Pending reservations" test above), so
    // an `Approved` row is required to actually exercise the constraint here.
    const now = new Date();
    const conflicting = Reservation.reconstitute({
      id: randomUUID(),
      userId: user.id,
      reservationGuestId: null,
      restaurantId,
      branchId,
      tableId,
      reservationDate: new Date('2026-09-06T00:00:00.000Z'),
      reservationStartTime: new Date('2026-09-06T18:30:00.000Z'),
      reservationEndTime: new Date('2026-09-06T20:00:00.000Z'),
      guests: 2,
      status: ReservationStatus.Approved,
      source: ReservationSource.Online,
      notes: null,
      createdBy: user.id,
      approvedBy: user.id,
      approvedAt: now,
      cancelledAt: null,
      completedAt: null,
      noShowAt: null,
      lateArrivalNotifiedAt: null,
      tableReadyNotifiedAt: null,
      rescheduledFromReservationId: null,
      createdAt: now,
      updatedAt: now,
    });

    // ADR-013's own named failure scenario is "application bug bypasses the
    // lock/pre-check" - the SELECT pre-check and the exclusion constraint
    // guard the *same* status set today (see the migration's WHERE clause),
    // so there is no reachable input that makes the real pre-check miss a
    // conflict the constraint would catch; reproducing the race genuinely
    // (two concurrent `createWithLock` calls) was tried and found to be
    // non-deterministic - Postgres resolves concurrent overlapping GiST
    // inserts as either a clean 23P01 exclusion-violation, a 40P01 deadlock,
    // or a pre-check catch, depending on timing. To deterministically
    // exercise the actual insert-time catch (not the pre-check), this test
    // forces the pre-check to return a false negative for this one call only
    // - simulating the exact "pre-check bypassed" scenario ADR-013 names -
    // while leaving `create()` and the database's exclusion constraint
    // completely real and untouched. If the constraint fires and the
    // repository's catch block does its job, `ReservationConflictException`
    // is thrown; if the catch block were removed, this test would instead
    // see a raw `PrismaClientUnknownRequestError` escape.
    const txClientHolder: { current: unknown } = { current: null };
    const forcedNoConflictContext = {
      get client() {
        return txClientHolder.current ?? rawPrisma;
      },
      async runInTransaction<T>(work: () => Promise<T>): Promise<T> {
        return rawPrisma.$transaction(async (tx) => {
          txClientHolder.current = new Proxy(tx, {
            get(target, prop, receiver) {
              if (prop === 'reservation') {
                return new Proxy(target.reservation, {
                  get(resTarget, resProp, resReceiver) {
                    if (resProp === 'findFirst') {
                      return async () => null;
                    }
                    return Reflect.get(resTarget, resProp, resReceiver);
                  },
                });
              }
              return Reflect.get(target, prop, receiver);
            },
          });
          try {
            return await work();
          } finally {
            txClientHolder.current = null;
          }
        });
      },
    };
    const forcedRepository = new PrismaReservationRepository(
      forcedNoConflictContext as unknown as ConstructorParameters<
        typeof PrismaReservationRepository
      >[0],
    );

    await expect(
      forcedRepository.createWithLock(conflicting, `lock-${randomUUID()}`),
    ).rejects.toBeInstanceOf(ReservationConflictException);
  });

  describe('Phase 7.6 (Operational Signals, ADR-019) - single-column CAS updates', () => {
    async function seedApprovedReservation(
      restaurantId: string,
      branchId: string,
      tableId: string,
      userId: string,
    ): Promise<string> {
      const created = await rawPrisma.reservation.create({
        data: {
          userId,
          restaurantId,
          branchId,
          tableId,
          reservationDate: new Date('2026-09-07T00:00:00.000Z'),
          reservationStartTime: new Date('2026-09-07T18:00:00.000Z'),
          reservationEndTime: new Date('2026-09-07T19:30:00.000Z'),
          guests: 2,
          status: 'Approved',
          source: 'Online',
          createdBy: userId,
        },
      });
      return created.id;
    }

    it('markLateArrivalNotifiedIfEligible applies once for an Approved, not-yet-notified reservation', async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
      const user = await seedUser();
      const id = await seedApprovedReservation(restaurantId, branchId, tableId, user.id);
      const at = new Date('2026-09-07T18:20:00.000Z');

      const applied = await repository.markLateArrivalNotifiedIfEligible(
        ReservationId.create(id),
        at,
      );

      expect(applied).toBe(true);
      const row = await rawPrisma.reservation.findUnique({ where: { id } });
      expect(row?.lateArrivalNotifiedAt).toEqual(at);
    });

    it('markLateArrivalNotifiedIfEligible: only ONE of N concurrent callers applies the CAS update (real Postgres row lock)', async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
      const user = await seedUser();
      const id = await seedApprovedReservation(restaurantId, branchId, tableId, user.id);
      const reservationId = ReservationId.create(id);

      const attempts = 5;
      const results = await Promise.all(
        Array.from({ length: attempts }, (_, i) =>
          repository.markLateArrivalNotifiedIfEligible(
            reservationId,
            new Date(Date.UTC(2026, 8, 7, 18, 20, i)),
          ),
        ),
      );

      expect(results.filter(Boolean)).toHaveLength(1);
      const row = await rawPrisma.reservation.findUnique({ where: { id } });
      expect(row?.lateArrivalNotifiedAt).not.toBeNull();
    });

    it('markTableReadyNotifiedIfEligible: only ONE of N concurrent callers applies the CAS update (real Postgres row lock)', async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
      const user = await seedUser();
      const id = await seedApprovedReservation(restaurantId, branchId, tableId, user.id);
      const reservationId = ReservationId.create(id);

      const attempts = 5;
      const results = await Promise.all(
        Array.from({ length: attempts }, (_, i) =>
          repository.markTableReadyNotifiedIfEligible(
            reservationId,
            new Date(Date.UTC(2026, 8, 7, 17, 50, i)),
          ),
        ),
      );

      expect(results.filter(Boolean)).toHaveLength(1);
      const row = await rawPrisma.reservation.findUnique({ where: { id } });
      expect(row?.tableReadyNotifiedAt).not.toBeNull();
    });

    it('markLateArrivalNotifiedIfEligible returns false when the reservation is no longer Approved', async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
      const user = await seedUser();
      const created = await rawPrisma.reservation.create({
        data: {
          userId: user.id,
          restaurantId,
          branchId,
          tableId,
          reservationDate: new Date('2026-09-08T00:00:00.000Z'),
          reservationStartTime: new Date('2026-09-08T18:00:00.000Z'),
          reservationEndTime: new Date('2026-09-08T19:30:00.000Z'),
          guests: 2,
          status: 'Completed',
          source: 'Online',
          createdBy: user.id,
        },
      });

      const applied = await repository.markLateArrivalNotifiedIfEligible(
        ReservationId.create(created.id),
        new Date(),
      );

      expect(applied).toBe(false);
    });

    it('markTableReadyNotifiedIfEligible returns false when already marked ready', async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
      const user = await seedUser();
      const id = await seedApprovedReservation(restaurantId, branchId, tableId, user.id);
      const reservationId = ReservationId.create(id);

      const first = await repository.markTableReadyNotifiedIfEligible(
        reservationId,
        new Date('2026-09-07T17:50:00.000Z'),
      );
      const second = await repository.markTableReadyNotifiedIfEligible(
        reservationId,
        new Date('2026-09-07T17:55:00.000Z'),
      );

      expect(first).toBe(true);
      expect(second).toBe(false);
    });
  });
});
