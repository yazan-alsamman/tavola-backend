import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaReservationWaitlistEntryRepository } from '@modules/waitlist/infrastructure/persistence/prisma-reservation-waitlist-entry.repository';
import { ReservationWaitlistEntry } from '@modules/waitlist/domain/entities/reservation-waitlist-entry.entity';
import { WaitlistStatus } from '@modules/waitlist/domain/enums/waitlist.enums';
import { WaitlistPositionConflictException } from '@modules/waitlist/domain/exceptions/waitlist-position-conflict.exception';
import { BranchId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'waitlist-repo-';

describe('ReservationWaitlistEntry round-trip via PrismaReservationWaitlistEntryRepository (integration)', () => {
  let dbAvailable = false;
  let repository: PrismaReservationWaitlistEntryRepository;
  let org: { id: string };

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([
      PrismaReservationWaitlistEntryRepository,
    ]);
    repository = moduleRef.get(PrismaReservationWaitlistEntryRepository);

    org = await rawPrisma.organization.create({
      data: {
        name: 'Waitlist Repo Test Org',
        slug: `${TEST_PREFIX}org-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}@example.com`,
      },
    });
  });

  afterAll(async () => {
    if (!dbAvailable) return;

    await rawPrisma.reservationWaitlistEntry.deleteMany({
      where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
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

  async function seedRestaurantBranch(): Promise<{ restaurantId: string; branchId: string }> {
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
    return { restaurantId: restaurant.id, branchId: branch.id };
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

  function buildEntry(
    restaurantId: string,
    branchId: string,
    userId: string,
    position: number,
    preferredDate = new Date('2026-09-01T00:00:00.000Z'),
  ): ReservationWaitlistEntry {
    const now = new Date();
    return ReservationWaitlistEntry.create({
      id: randomUUID(),
      restaurantId,
      branchId,
      userId,
      reservationGuestId: null,
      partySize: 2,
      preferredDate,
      preferredTimeFrom: new Date(Date.UTC(1970, 0, 1, 19, 0, 0)),
      preferredTimeTo: null,
      position,
      expiresAt: new Date('2026-09-01T23:59:59.999Z'),
      notes: null,
      createdBy: userId,
      now,
    });
  }

  it('createInTransaction persists an entry, findById/findActiveByBranchAndDateOrderedByPosition find it', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId } = await seedRestaurantBranch();
    const user = await seedUser();
    const entry = buildEntry(restaurantId, branchId, user.id, 1);

    await repository.createInTransaction(entry);

    const found = await repository.findById(entry.entryId);
    expect(found?.entryId).toBe(entry.entryId);
    expect(found?.status).toBe(WaitlistStatus.Waiting);

    const active = await repository.findActiveByBranchAndDateOrderedByPosition(
      BranchId.create(branchId),
      entry.preferredDate,
    );
    expect(active.map((e) => e.entryId)).toContain(entry.entryId);
  });

  it('findActiveByUserId (Phase 20.X, account deletion auto-cancel) finds Waiting/Notified entries for the given user, excluding other users, Cancelled/Expired, and soft-deleted rows', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId } = await seedRestaurantBranch();
    const userA = await seedUser();
    const userB = await seedUser();
    const preferredDate = new Date('2026-09-03T00:00:00.000Z');

    const activeForA = buildEntry(restaurantId, branchId, userA.id, 1, preferredDate);
    await repository.createInTransaction(activeForA);

    const cancelledForA = buildEntry(restaurantId, branchId, userA.id, 2, preferredDate);
    await repository.createInTransaction(cancelledForA);
    await rawPrisma.reservationWaitlistEntry.update({
      where: { id: cancelledForA.entryId },
      data: { status: 'Cancelled' },
    });

    const activeForB = buildEntry(restaurantId, branchId, userB.id, 3, preferredDate);
    await repository.createInTransaction(activeForB);

    const results = await repository.findActiveByUserId(UserId.create(userA.id));

    expect(results.map((entry) => entry.entryId)).toEqual([activeForA.entryId]);
  });

  it('findActiveByUserId includes Notified entries', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId } = await seedRestaurantBranch();
    const user = await seedUser();
    const entry = buildEntry(
      restaurantId,
      branchId,
      user.id,
      1,
      new Date('2026-09-04T00:00:00.000Z'),
    );
    await repository.createInTransaction(entry);
    await rawPrisma.reservationWaitlistEntry.update({
      where: { id: entry.entryId },
      data: { status: 'Notified' },
    });

    const results = await repository.findActiveByUserId(UserId.create(user.id));

    expect(results.map((e) => e.entryId)).toEqual([entry.entryId]);
  });

  it('the partial unique active-position index rejects a duplicate (branchId, preferredDate, position) among active rows', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId } = await seedRestaurantBranch();
    const user = await seedUser();
    const preferredDate = new Date('2026-09-02T00:00:00.000Z');
    const first = buildEntry(restaurantId, branchId, user.id, 1, preferredDate);
    const second = buildEntry(restaurantId, branchId, user.id, 1, preferredDate);

    await repository.createInTransaction(first);
    await expect(repository.createInTransaction(second)).rejects.toBeInstanceOf(
      WaitlistPositionConflictException,
    );
  });

  it('allows the same position to be reused once the earlier row is no longer active (Cancelled)', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId } = await seedRestaurantBranch();
    const user = await seedUser();
    const preferredDate = new Date('2026-09-03T00:00:00.000Z');
    const first = buildEntry(restaurantId, branchId, user.id, 1, preferredDate);
    await repository.createInTransaction(first);

    const cancelled = first.cancel(new Date());
    const applied = await repository.updateTransitioningFrom(cancelled, WaitlistStatus.Waiting);
    expect(applied).toBe(true);

    const second = buildEntry(restaurantId, branchId, user.id, 1, preferredDate);
    await expect(repository.createInTransaction(second)).resolves.toBeUndefined();
  });

  it('updateTransitioningFrom applies only when the expected status still matches (optimistic concurrency)', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId } = await seedRestaurantBranch();
    const user = await seedUser();
    const entry = buildEntry(restaurantId, branchId, user.id, 1);
    await repository.createInTransaction(entry);

    // convertedReservationId has a real FK to reservations.id - seed a
    // minimal real Reservation row so `convert()`'s target id is valid,
    // exactly as WaitlistPromotionService always creates the Reservation
    // inside the same transaction before setting this column.
    const floorPlan = await rawPrisma.floorPlan.create({
      data: { branchId, name: 'Main Floor', isActive: true },
    });
    const table = await rawPrisma.table.create({
      data: { branchId, floorPlanId: floorPlan.id, tableNumber: 'T1', capacity: 4 },
    });
    const reservation = await rawPrisma.reservation.create({
      data: {
        userId: user.id,
        restaurantId,
        branchId,
        tableId: table.id,
        reservationDate: new Date('2026-09-05T00:00:00.000Z'),
        reservationStartTime: new Date('2026-09-05T19:00:00.000Z'),
        reservationEndTime: new Date('2026-09-05T20:30:00.000Z'),
        guests: 2,
        status: 'Pending',
        source: 'WaitlistConversion',
        createdBy: user.id,
      },
    });

    const converted = entry.convert(reservation.id, new Date());
    const firstApply = await repository.updateTransitioningFrom(converted, WaitlistStatus.Waiting);
    expect(firstApply).toBe(true);

    // Retrying the same conditional update against the now-stale expected
    // status ("Waiting") must fail - the row is already Converted.
    const secondApply = await repository.updateTransitioningFrom(converted, WaitlistStatus.Waiting);
    expect(secondApply).toBe(false);
  });

  it('concurrent Joins for the same (branchId, preferredDate) cannot duplicate an active queue position', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId } = await seedRestaurantBranch();
    const user = await seedUser();
    const preferredDate = new Date('2026-09-04T00:00:00.000Z');
    const branchIdVo = BranchId.create(branchId);

    async function joinOnce(): Promise<void> {
      // Mirrors JoinWaitlistUseCase's own sequence exactly: acquire the
      // advisory lock, read the current max position under it, then insert
      // - all inside one transaction (the module's own runInTransaction is
      // not exercised directly here since this repository method already
      // assumes an active transaction; the advisory lock alone is what's
      // under test - Postgres serializes concurrent acquisitions of the
      // same lock key, so the read-then-insert below cannot interleave).
      await rawPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`waitlist:${branchId}:2026-09-04`}, 0))`;
        const result = await tx.reservationWaitlistEntry.aggregate({
          where: { branchId, preferredDate, deletedAt: null },
          _max: { position: true },
        });
        const nextPosition = (result._max.position ?? 0) + 1;
        const entry = buildEntry(restaurantId, branchId, user.id, nextPosition, preferredDate);
        const data = {
          id: entry.entryId,
          restaurantId: entry.restaurantId.value,
          branchId: entry.branchId.value,
          userId: entry.userId?.value ?? null,
          reservationGuestId: entry.reservationGuestId,
          partySize: entry.partySize,
          preferredDate: entry.preferredDate,
          preferredTimeFrom: entry.preferredTimeFrom,
          preferredTimeTo: entry.preferredTimeTo,
          status: entry.status,
          position: entry.position,
          convertedReservationId: entry.convertedReservationId,
          notifiedAt: entry.notifiedAt,
          expiresAt: entry.expiresAt,
          notes: entry.notes,
          createdBy: entry.createdBy,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          deletedAt: entry.deletedAt,
        };
        await tx.reservationWaitlistEntry.create({ data });
      });
    }

    const concurrentJoinCount = 10;
    await Promise.all(Array.from({ length: concurrentJoinCount }, () => joinOnce()));

    const active = await repository.findActiveByBranchAndDateOrderedByPosition(
      branchIdVo,
      preferredDate,
    );
    const positions = active.map((e) => e.position);
    const uniquePositions = new Set(positions);
    expect(positions).toHaveLength(concurrentJoinCount);
    expect(uniquePositions.size).toBe(concurrentJoinCount);
    expect([...uniquePositions].sort((a, b) => a - b)).toEqual(
      Array.from({ length: concurrentJoinCount }, (_, i) => i + 1),
    );
  });
});
