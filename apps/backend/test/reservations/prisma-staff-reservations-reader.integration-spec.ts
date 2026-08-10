import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaStaffReservationsReader } from '@modules/reservations/infrastructure/persistence/prisma-staff-reservations.reader';
import {
  ReservationSource,
  ReservationStatus,
} from '@modules/reservations/domain/enums/reservation.enums';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'staff-reservations-reader-';

/**
 * Proves `PrismaStaffReservationsReader`'s join query (Table/User/
 * ReservationGuest enrichment), restaurant/branch scoping, date-range
 * filtering (against `reservationDate`, inclusive), status filtering,
 * pagination, and `reservationStartTime asc` ordering against real Postgres -
 * the Restaurant Dashboard Calendar's sole read path. Unit-level
 * authorization/date-validation behavior is covered separately by
 * `ListBranchReservationsUseCase`'s own spec against the in-memory fake.
 */
describe('PrismaStaffReservationsReader (integration)', () => {
  let dbAvailable = false;
  let reader: PrismaStaffReservationsReader;
  let org: { id: string };

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([PrismaStaffReservationsReader]);
    reader = moduleRef.get(PrismaStaffReservationsReader);

    org = await rawPrisma.organization.create({
      data: {
        name: 'Staff Reservations Reader Test Org',
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
    await rawPrisma.reservationGuest.deleteMany({ where: { phone: { startsWith: '+1555999' } } });
    await rawPrisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
    await rawPrisma.organization.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.$disconnect();
  });

  async function seedRestaurantBranchTable() {
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
      data: { branchId: branch.id, floorPlanId: floorPlan.id, tableNumber: 'T1', capacity: 4 },
    });
    return { restaurantId: restaurant.id, branchId: branch.id, tableId: table.id };
  }

  async function seedUser(suffix: string) {
    return rawPrisma.user.create({
      data: {
        firstName: 'Jane',
        lastName: suffix,
        email: `${TEST_PREFIX}${suffix}-${randomUUID()}@example.com`,
        phone: `+1555888${Math.floor(Math.random() * 10000)}`,
        passwordHash: 'argon2id$fake$not-used-by-this-spec',
        language: 'en',
      },
    });
  }

  async function seedGuest() {
    return rawPrisma.reservationGuest.create({
      data: { fullName: 'Walk-in Guest', phone: `+1555999${Math.floor(Math.random() * 10000)}` },
    });
  }

  async function seedReservation(params: {
    restaurantId: string;
    branchId: string;
    tableId: string;
    userId?: string;
    reservationGuestId?: string;
    status?: ReservationStatus;
    reservationDate?: Date;
    reservationStartTime?: Date;
    notes?: string | null;
  }) {
    const reservationDate = params.reservationDate ?? new Date('2026-09-01T00:00:00.000Z');
    const reservationStartTime =
      params.reservationStartTime ?? new Date(reservationDate.getTime() + 18 * 60 * 60 * 1000);
    return rawPrisma.reservation.create({
      data: {
        id: randomUUID(),
        userId: params.userId ?? null,
        reservationGuestId: params.reservationGuestId ?? null,
        restaurantId: params.restaurantId,
        branchId: params.branchId,
        tableId: params.tableId,
        reservationDate,
        reservationStartTime,
        reservationEndTime: new Date(reservationStartTime.getTime() + 90 * 60 * 1000),
        guests: 2,
        status: params.status ?? ReservationStatus.Approved,
        source: params.userId ? ReservationSource.Online : ReservationSource.WalkIn,
        notes: params.notes ?? null,
      },
    });
  }

  const RANGE = {
    dateFrom: new Date('2026-09-01T00:00:00.000Z'),
    dateTo: new Date('2026-09-30T00:00:00.000Z'),
  };

  it('returns the enriched table + User customer fields for an Online reservation', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
    const user = await seedUser('online');
    await seedReservation({
      restaurantId,
      branchId,
      tableId,
      userId: user.id,
      notes: 'Window seat please',
    });

    const page = await reader.search(restaurantId, branchId, RANGE, 1, 20);

    expect(page.total).toBe(1);
    const item = page.items[0];
    expect(item.restaurantId).toBe(restaurantId);
    expect(item.branchId).toBe(branchId);
    expect(item.partySize).toBe(2);
    expect(item.specialRequest).toBe('Window seat please');
    expect(item.table).toEqual({ tableId, tableNumber: 'T1', capacity: 4 });
    expect(item.customer).toEqual({
      type: 'User',
      name: `Jane ${user.lastName}`,
      phone: user.phone,
    });
  });

  it('returns the ReservationGuest customer fields for a WalkIn reservation', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
    const guest = await seedGuest();
    await seedReservation({ restaurantId, branchId, tableId, reservationGuestId: guest.id });

    const page = await reader.search(restaurantId, branchId, RANGE, 1, 20);

    expect(page.total).toBe(1);
    expect(page.items[0].customer).toEqual({
      type: 'Guest',
      name: 'Walk-in Guest',
      phone: guest.phone,
    });
  });

  it('scopes strictly to restaurantId + branchId (a reservation from another restaurant/branch never leaks in)', async () => {
    if (!dbAvailable) return;

    const target = await seedRestaurantBranchTable();
    const other = await seedRestaurantBranchTable();
    const user = await seedUser('isolation');
    await seedReservation({ ...target, userId: user.id });
    await seedReservation({ ...other, userId: user.id });

    const page = await reader.search(target.restaurantId, target.branchId, RANGE, 1, 20);

    expect(page.total).toBe(1);
    expect(page.items[0].branchId).toBe(target.branchId);
  });

  it('filters inclusively by dateFrom/dateTo against reservationDate (boundary dates included, outside excluded)', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
    const user = await seedUser('boundary');
    await seedReservation({
      restaurantId,
      branchId,
      tableId,
      userId: user.id,
      reservationDate: new Date('2026-09-01T00:00:00.000Z'),
    });
    await seedReservation({
      restaurantId,
      branchId,
      tableId,
      userId: user.id,
      reservationDate: new Date('2026-09-30T00:00:00.000Z'),
    });
    await seedReservation({
      restaurantId,
      branchId,
      tableId,
      userId: user.id,
      reservationDate: new Date('2026-08-31T00:00:00.000Z'),
    });
    await seedReservation({
      restaurantId,
      branchId,
      tableId,
      userId: user.id,
      reservationDate: new Date('2026-10-01T00:00:00.000Z'),
    });

    const page = await reader.search(restaurantId, branchId, RANGE, 1, 20);

    expect(page.total).toBe(2);
  });

  it('filters by status when provided', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
    const user = await seedUser('status');
    await seedReservation({
      restaurantId,
      branchId,
      tableId,
      userId: user.id,
      status: ReservationStatus.Approved,
    });
    await seedReservation({
      restaurantId,
      branchId,
      tableId,
      userId: user.id,
      status: ReservationStatus.Cancelled,
    });

    const page = await reader.search(
      restaurantId,
      branchId,
      { ...RANGE, status: ReservationStatus.Cancelled },
      1,
      20,
    );

    expect(page.total).toBe(1);
    expect(page.items[0].status).toBe(ReservationStatus.Cancelled);
  });

  it('orders reservationStartTime ascending and paginates', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
    const user = await seedUser('order');
    for (let i = 0; i < 3; i += 1) {
      await seedReservation({
        restaurantId,
        branchId,
        tableId,
        userId: user.id,
        reservationDate: new Date('2026-09-10T00:00:00.000Z'),
        reservationStartTime: new Date(
          `2026-09-10T${(10 + i * 3).toString().padStart(2, '0')}:00:00.000Z`,
        ),
      });
    }

    const firstPage = await reader.search(restaurantId, branchId, RANGE, 1, 2);
    expect(firstPage.total).toBe(3);
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.items[0].reservationStartTime.getTime()).toBeLessThan(
      firstPage.items[1].reservationStartTime.getTime(),
    );

    const secondPage = await reader.search(restaurantId, branchId, RANGE, 2, 2);
    expect(secondPage.items).toHaveLength(1);
  });
});
