import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaReservationRepository } from '@modules/reservations/infrastructure/persistence/prisma-reservation.repository';
import { PrismaReservationGuestRepository } from '@modules/reservations/infrastructure/persistence/prisma-reservation-guest.repository';
import { PrismaUnitOfWork } from '@modules/authentication/infrastructure/persistence/prisma-unit-of-work';
import { Reservation } from '@modules/reservations/domain/entities/reservation.entity';
import { ReservationGuest } from '@modules/reservations/domain/entities/reservation-guest.entity';
import { ReservationSource } from '@modules/reservations/domain/enums/reservation.enums';
import { ReservationConflictException } from '@modules/reservations/domain/exceptions/reservation-conflict.exception';
import { ReservationAvailabilityService } from '@modules/reservations/domain/services/reservation-availability.service';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'reservation-guest-repo-';

describe('ReservationGuest round-trip + Phase 7.4 atomicity (integration)', () => {
  let dbAvailable = false;
  let reservationRepository: PrismaReservationRepository;
  let reservationGuestRepository: PrismaReservationGuestRepository;
  let unitOfWork: PrismaUnitOfWork;
  let org: { id: string };

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([
      PrismaReservationRepository,
      PrismaReservationGuestRepository,
      PrismaUnitOfWork,
    ]);
    reservationRepository = moduleRef.get(PrismaReservationRepository);
    reservationGuestRepository = moduleRef.get(PrismaReservationGuestRepository);
    unitOfWork = moduleRef.get(PrismaUnitOfWork);

    org = await rawPrisma.organization.create({
      data: {
        name: 'Reservation Guest Repo Test Org',
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
    await rawPrisma.reservationGuest.deleteMany({ where: { phone: { startsWith: '+963' } } });
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

  function buildGuest(overrides: Partial<{ phoneNumber: string }> = {}): ReservationGuest {
    return ReservationGuest.create({
      id: randomUUID(),
      fullName: 'Jane Guest',
      countryCode: 'SY',
      phoneNumber: overrides.phoneNumber ?? '0912345678',
      email: null,
      now: new Date(),
    });
  }

  it('save() persists a ReservationGuest row, readable via a raw Prisma lookup', async () => {
    if (!dbAvailable) return;

    const guest = buildGuest();
    await reservationGuestRepository.save(guest);

    const row = await rawPrisma.reservationGuest.findUnique({ where: { id: guest.guestId } });
    expect(row).not.toBeNull();
    expect(row?.fullName).toBe('Jane Guest');
    expect(row?.phone).toBe('+963912345678');
    expect(row?.anonymizedAt).toBeNull();
  });

  // CHECK constraints are not modeled in schema.prisma (same reasoning as
  // ADR-013's own exclusion constraint - PrismaReservationRepository.ts's own
  // doc comment), so a violation surfaces as PrismaClientUnknownRequestError
  // with the raw SQLSTATE 23514 embedded, not a Prisma-recognized error code.
  it('the reservation-party CHECK constraint rejects a raw row with both userId and reservationGuestId set', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
    const user = await seedUser();
    const guest = buildGuest({ phoneNumber: '0912345679' });
    await reservationGuestRepository.save(guest);

    await expect(
      rawPrisma.reservation.create({
        data: {
          userId: user.id,
          reservationGuestId: guest.guestId,
          restaurantId,
          branchId,
          tableId,
          reservationDate: new Date('2026-09-10T00:00:00.000Z'),
          reservationStartTime: new Date('2026-09-10T18:00:00.000Z'),
          reservationEndTime: new Date('2026-09-10T19:30:00.000Z'),
          guests: 2,
          status: 'Pending',
          source: 'Phone',
          createdBy: user.id,
        },
      }),
    ).rejects.toThrow(Prisma.PrismaClientUnknownRequestError);
  });

  it('the reservation-party CHECK constraint rejects a raw row with neither userId nor reservationGuestId set', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();

    await expect(
      rawPrisma.reservation.create({
        data: {
          restaurantId,
          branchId,
          tableId,
          reservationDate: new Date('2026-09-11T00:00:00.000Z'),
          reservationStartTime: new Date('2026-09-11T18:00:00.000Z'),
          reservationEndTime: new Date('2026-09-11T19:30:00.000Z'),
          guests: 2,
          status: 'Pending',
          source: 'Phone',
          createdBy: randomUUID(),
        },
      }),
    ).rejects.toThrow(Prisma.PrismaClientUnknownRequestError);
  });

  it('binding clarification #2: a ReservationConflictException inside the same transaction leaves NO orphan ReservationGuest row', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
    const user = await seedUser();

    // A real, already-committed confirmed reservation for this table/window -
    // guarantees createWithLockInTransaction's own pre-check throws
    // ReservationConflictException before the insert.
    await rawPrisma.reservation.create({
      data: {
        userId: user.id,
        restaurantId,
        branchId,
        tableId,
        reservationDate: new Date('2026-09-12T00:00:00.000Z'),
        reservationStartTime: new Date('2026-09-12T18:00:00.000Z'),
        reservationEndTime: new Date('2026-09-12T19:30:00.000Z'),
        guests: 2,
        status: 'Approved',
        source: 'Online',
        createdBy: user.id,
      },
    });

    const guest = buildGuest({ phoneNumber: '0912345680' });
    const conflicting = Reservation.create({
      id: randomUUID(),
      userId: null,
      reservationGuestId: guest.guestId,
      source: ReservationSource.Phone,
      restaurantId,
      branchId,
      tableId,
      reservationDate: new Date('2026-09-12T00:00:00.000Z'),
      reservationStartTime: new Date('2026-09-12T18:30:00.000Z'),
      reservationEndTime: new Date('2026-09-12T20:00:00.000Z'),
      guests: 2,
      tableCapacity: 4,
      notes: null,
      createdBy: randomUUID(),
      now: new Date(),
    });
    const lockKey = ReservationAvailabilityService.deriveLockKey(
      branchId,
      tableId,
      conflicting.reservationDate,
      ReservationAvailabilityService.deriveTimeSlotBucket(conflicting.reservationStartTime, 30),
    );

    await expect(
      unitOfWork.execute(async () => {
        await reservationGuestRepository.save(guest);
        await reservationRepository.createWithLockInTransaction(conflicting, lockKey);
      }),
    ).rejects.toBeInstanceOf(ReservationConflictException);

    // The transaction rolled back entirely - the guest row saved moments
    // before the conflicting insert must not exist either (binding
    // clarification #2: no orphan ReservationGuest on any transactional
    // failure).
    const row = await rawPrisma.reservationGuest.findUnique({ where: { id: guest.guestId } });
    expect(row).toBeNull();
  });

  it('a successful Phone reservation persists both the ReservationGuest and the Reservation atomically', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
    const guest = buildGuest({ phoneNumber: '0912345681' });
    const reservation = Reservation.create({
      id: randomUUID(),
      userId: null,
      reservationGuestId: guest.guestId,
      source: ReservationSource.Phone,
      restaurantId,
      branchId,
      tableId,
      reservationDate: new Date('2026-09-13T00:00:00.000Z'),
      reservationStartTime: new Date('2026-09-13T18:00:00.000Z'),
      reservationEndTime: new Date('2026-09-13T19:30:00.000Z'),
      guests: 2,
      tableCapacity: 4,
      notes: null,
      createdBy: randomUUID(),
      now: new Date(),
    });
    const lockKey = ReservationAvailabilityService.deriveLockKey(
      branchId,
      tableId,
      reservation.reservationDate,
      ReservationAvailabilityService.deriveTimeSlotBucket(reservation.reservationStartTime, 30),
    );

    await unitOfWork.execute(async () => {
      await reservationGuestRepository.save(guest);
      await reservationRepository.createWithLockInTransaction(reservation, lockKey);
    });

    const guestRow = await rawPrisma.reservationGuest.findUnique({ where: { id: guest.guestId } });
    const reservationRow = await rawPrisma.reservation.findUnique({
      where: { id: reservation.reservationId.value },
    });
    expect(guestRow).not.toBeNull();
    expect(reservationRow).not.toBeNull();
    expect(reservationRow?.reservationGuestId).toBe(guest.guestId);
    expect(reservationRow?.userId).toBeNull();
  });
});
