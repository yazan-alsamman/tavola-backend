import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaMyReservationsReader } from '@modules/reservations/infrastructure/persistence/prisma-my-reservations.reader';
import {
  ReservationSource,
  ReservationStatus,
} from '@modules/reservations/domain/enums/reservation.enums';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'my-reservations-reader-';
const NOW = new Date('2026-08-15T00:00:00.000Z');

/**
 * Proves `PrismaMyReservationsReader`'s join query - restaurant/branch/table
 * enrichment, filters, `all`/`upcoming`/`history` scope derivation, sort/
 * order, pagination, and the soft-deleted-restaurant-still-visible rule -
 * against real Postgres. Unit-level filter/pagination/isolation/scope
 * behavior is covered separately by `SearchMyReservationsUseCase`'s own spec
 * against the in-memory fake.
 */
describe('PrismaMyReservationsReader (integration)', () => {
  let dbAvailable = false;
  let reader: PrismaMyReservationsReader;
  let org: { id: string };
  let user: { id: string };

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([PrismaMyReservationsReader]);
    reader = moduleRef.get(PrismaMyReservationsReader);

    org = await rawPrisma.organization.create({
      data: {
        name: 'MyReservations Reader Test Org',
        slug: `${TEST_PREFIX}org-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}@example.com`,
      },
    });
    user = await rawPrisma.user.create({
      data: {
        firstName: 'Test',
        lastName: 'Customer',
        email: `${TEST_PREFIX}user-${randomUUID()}@example.com`,
        passwordHash: 'argon2id$fake$not-used-by-this-spec',
        language: 'en',
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

  async function seedRestaurantBranchTable(
    overrides: Partial<{ name: string; coverImageId: string | null; deletedAt: Date | null }> = {},
  ) {
    const restaurant = await rawPrisma.restaurant.create({
      data: {
        organizationId: org.id,
        name: overrides.name ?? 'The Old Mill',
        slug: `${TEST_PREFIX}${randomUUID()}`,
        status: 'Active',
        coverImageId: overrides.coverImageId ?? null,
        deletedAt: overrides.deletedAt ?? null,
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
        firstName: 'Isolated',
        lastName: suffix,
        email: `${TEST_PREFIX}${suffix}-${randomUUID()}@example.com`,
        passwordHash: 'argon2id$fake$not-used-by-this-spec',
        language: 'en',
      },
    });
  }

  async function seedReservation(params: {
    restaurantId: string;
    branchId: string;
    tableId: string;
    userId: string;
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
        userId: params.userId,
        restaurantId: params.restaurantId,
        branchId: params.branchId,
        tableId: params.tableId,
        reservationDate,
        reservationStartTime,
        reservationEndTime: new Date(reservationStartTime.getTime() + 90 * 60 * 1000),
        guests: 2,
        status: params.status ?? ReservationStatus.Completed,
        source: ReservationSource.Online,
        notes: params.notes ?? null,
      },
    });
  }

  it('returns the enriched restaurant/branch/table fields for a single owned reservation', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable({
      name: 'Enrichment Test Restaurant',
      coverImageId: '99999999-9999-4999-8999-999999999999',
    });
    await seedReservation({
      restaurantId,
      branchId,
      tableId,
      userId: user.id,
      notes: 'Window seat please',
    });

    const page = await reader.search(user.id, 'all', {}, 1, 20, 'reservationDate', 'desc', NOW);

    expect(page.total).toBe(1);
    const item = page.items[0];
    expect(item.restaurantId).toBe(restaurantId);
    expect(item.restaurantName).toBe('Enrichment Test Restaurant');
    expect(item.restaurantImage).toBe('99999999-9999-4999-8999-999999999999');
    expect(item.branchId).toBe(branchId);
    expect(item.branchName).toBe('123 Main St');
    expect(item.partySize).toBe(2);
    expect(item.specialRequest).toBe('Window seat please');
    expect(item.table).toEqual({ tableId, tableNumber: 'T1', capacity: 4 });
  });

  it('returns an empty page for a customer with no reservations', async () => {
    if (!dbAvailable) return;
    const page = await reader.search(
      randomUUID(),
      'all',
      {},
      1,
      20,
      'reservationDate',
      'desc',
      NOW,
    );
    expect(page.total).toBe(0);
    expect(page.items).toEqual([]);
  });

  it('paginates results', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
    const isolatedUser = await seedUser('page');
    for (let i = 0; i < 3; i += 1) {
      await seedReservation({
        restaurantId,
        branchId,
        tableId,
        userId: isolatedUser.id,
        reservationDate: new Date(`2026-09-0${i + 1}T00:00:00.000Z`),
      });
    }

    const page = await reader.search(
      isolatedUser.id,
      'all',
      {},
      2,
      2,
      'reservationDate',
      'asc',
      NOW,
    );

    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(1);
  });

  it('filters by status (scope all), restaurantId, branchId, and date range', async () => {
    if (!dbAvailable) return;

    const restaurantA = await seedRestaurantBranchTable();
    const restaurantB = await seedRestaurantBranchTable();
    const isolatedUser = await seedUser('filter');
    await seedReservation({
      ...restaurantA,
      userId: isolatedUser.id,
      status: ReservationStatus.Completed,
      reservationDate: new Date('2026-01-10T00:00:00.000Z'),
    });
    await seedReservation({
      ...restaurantA,
      userId: isolatedUser.id,
      status: ReservationStatus.Cancelled,
      reservationDate: new Date('2026-06-10T00:00:00.000Z'),
    });
    await seedReservation({
      ...restaurantB,
      userId: isolatedUser.id,
      status: ReservationStatus.Completed,
      reservationDate: new Date('2026-01-15T00:00:00.000Z'),
    });

    const statusFiltered = await reader.search(
      isolatedUser.id,
      'all',
      { status: ReservationStatus.Cancelled },
      1,
      20,
      'reservationDate',
      'desc',
      NOW,
    );
    expect(statusFiltered.total).toBe(1);
    expect(statusFiltered.items[0].status).toBe(ReservationStatus.Cancelled);

    const restaurantFiltered = await reader.search(
      isolatedUser.id,
      'all',
      { restaurantId: restaurantA.restaurantId },
      1,
      20,
      'reservationDate',
      'desc',
      NOW,
    );
    expect(restaurantFiltered.total).toBe(2);

    const branchFiltered = await reader.search(
      isolatedUser.id,
      'all',
      { branchId: restaurantB.branchId },
      1,
      20,
      'reservationDate',
      'desc',
      NOW,
    );
    expect(branchFiltered.total).toBe(1);
    expect(branchFiltered.items[0].branchId).toBe(restaurantB.branchId);

    const dateFiltered = await reader.search(
      isolatedUser.id,
      'all',
      {
        dateFrom: new Date('2026-03-01T00:00:00.000Z'),
        dateTo: new Date('2026-12-31T00:00:00.000Z'),
      },
      1,
      20,
      'reservationDate',
      'desc',
      NOW,
    );
    expect(dateFiltered.total).toBe(1);
    expect(dateFiltered.items[0].status).toBe(ReservationStatus.Cancelled);
  });

  it("never returns another customer's reservations (cross-customer isolation)", async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
    const customerA = await seedUser('a');
    const customerB = await seedUser('b');
    await seedReservation({ restaurantId, branchId, tableId, userId: customerA.id });

    const page = await reader.search(
      customerB.id,
      'all',
      {},
      1,
      20,
      'reservationDate',
      'desc',
      NOW,
    );

    expect(page.total).toBe(0);
  });

  it('still returns a reservation whose restaurant has since been soft-deleted', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable({
      name: 'Closed Restaurant',
    });
    const isolatedUser = await seedUser('softdelete');
    await seedReservation({ restaurantId, branchId, tableId, userId: isolatedUser.id });
    await rawPrisma.restaurant.update({
      where: { id: restaurantId },
      data: { deletedAt: new Date() },
    });

    const page = await reader.search(
      isolatedUser.id,
      'all',
      {},
      1,
      20,
      'reservationDate',
      'desc',
      NOW,
    );

    expect(page.total).toBe(1);
    expect(page.items[0].restaurantName).toBe('Closed Restaurant');
  });

  describe('scope derivation', () => {
    it("scope 'upcoming' returns only active reservations scheduled after now", async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
      const isolatedUser = await seedUser('upcoming');
      const upcomingApproved = await seedReservation({
        restaurantId,
        branchId,
        tableId,
        userId: isolatedUser.id,
        status: ReservationStatus.Approved,
        reservationStartTime: new Date('2026-09-01T18:00:00.000Z'),
      });
      await seedReservation({
        restaurantId,
        branchId,
        tableId,
        userId: isolatedUser.id,
        status: ReservationStatus.Completed,
        reservationStartTime: new Date('2026-07-01T18:00:00.000Z'),
      });
      await seedReservation({
        restaurantId,
        branchId,
        tableId,
        userId: isolatedUser.id,
        status: ReservationStatus.Approved,
        reservationStartTime: new Date('2026-07-05T18:00:00.000Z'),
      });

      const page = await reader.search(
        isolatedUser.id,
        'upcoming',
        {},
        1,
        20,
        'reservationDate',
        'desc',
        NOW,
      );

      expect(page.total).toBe(1);
      expect(page.items[0].reservationId).toBe(upcomingApproved.id);
    });

    it("scope 'history' returns terminal reservations plus active-but-past ones, complementing 'upcoming'", async () => {
      if (!dbAvailable) return;

      const { restaurantId, branchId, tableId } = await seedRestaurantBranchTable();
      const isolatedUser = await seedUser('history');
      await seedReservation({
        restaurantId,
        branchId,
        tableId,
        userId: isolatedUser.id,
        status: ReservationStatus.Approved,
        reservationStartTime: new Date('2026-09-01T18:00:00.000Z'),
      });
      const pastCompleted = await seedReservation({
        restaurantId,
        branchId,
        tableId,
        userId: isolatedUser.id,
        status: ReservationStatus.Completed,
        reservationStartTime: new Date('2026-07-01T18:00:00.000Z'),
      });
      const stalePastApproved = await seedReservation({
        restaurantId,
        branchId,
        tableId,
        userId: isolatedUser.id,
        status: ReservationStatus.Approved,
        reservationStartTime: new Date('2026-07-05T18:00:00.000Z'),
      });

      const [all, upcoming, history] = await Promise.all([
        reader.search(isolatedUser.id, 'all', {}, 1, 20, 'reservationDate', 'asc', NOW),
        reader.search(isolatedUser.id, 'upcoming', {}, 1, 20, 'reservationDate', 'asc', NOW),
        reader.search(isolatedUser.id, 'history', {}, 1, 20, 'reservationDate', 'asc', NOW),
      ]);

      const historyIds = history.items.map((item) => item.reservationId).sort();
      expect(historyIds).toEqual([pastCompleted.id, stalePastApproved.id].sort());
      expect(upcoming.total + history.total).toBe(all.total);
    });
  });
});
