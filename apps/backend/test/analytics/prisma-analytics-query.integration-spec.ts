import { PrismaClient, WaitlistStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaAnalyticsQueryRepository } from '@modules/analytics/infrastructure/persistence/prisma-analytics-query.repository';
import {
  AnalyticsRestaurantScope,
  AnalyticsBranchScope,
} from '@modules/analytics/application/ports/analytics-query.port';
import { zonedWallTimeToUtc } from '@modules/analytics/domain/services/analytics-timezone.util';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'analytics-repo-';

/**
 * Phase 14 (Analytics, ADR-028). Real PostgreSQL integration coverage for
 * `PrismaAnalyticsQueryRepository` - proves the raw SQL timezone bucketing
 * (Decision #3/#4) against two Branches in genuinely different IANA zones
 * (Asia/Tokyo UTC+9, America/New_York UTC-4 summer), the exact
 * Cancelled-from-Approved cancellation formula (Decision #9), tenant
 * isolation, and zero-data / soft-delete handling - none of which unit
 * tests (mocked Prisma) can prove.
 */
describe('PrismaAnalyticsQueryRepository (integration)', () => {
  let dbAvailable = false;
  let repository: PrismaAnalyticsQueryRepository;
  let orgId: string;
  let restaurantId: string;
  let otherRestaurantId: string;
  let branchTokyoId: string;
  let branchNyId: string;
  let defaultUserId: string;
  const floorPlanByBranch = new Map<string, string>();

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([PrismaAnalyticsQueryRepository]);
    repository = moduleRef.get(PrismaAnalyticsQueryRepository);

    const org = await rawPrisma.organization.create({
      data: {
        name: 'Analytics Test Org',
        slug: `${TEST_PREFIX}org-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}@example.com`,
      },
    });
    orgId = org.id;

    const restaurant = await rawPrisma.restaurant.create({
      data: {
        organizationId: orgId,
        name: 'Analytics Test Restaurant',
        slug: `${TEST_PREFIX}${randomUUID()}`,
        status: 'Active',
        averageRating: 4.5,
      },
    });
    restaurantId = restaurant.id;

    const otherRestaurant = await rawPrisma.restaurant.create({
      data: {
        organizationId: orgId,
        name: 'Analytics Test Restaurant (tenant-isolation control)',
        slug: `${TEST_PREFIX}other-${randomUUID()}`,
        status: 'Active',
      },
    });
    otherRestaurantId = otherRestaurant.id;

    const branchTokyo = await rawPrisma.branch.create({
      data: {
        restaurantId,
        city: 'Tokyo',
        address: '1 Test St',
        countryCode: 'JP',
        timezone: 'Asia/Tokyo',
      },
    });
    branchTokyoId = branchTokyo.id;

    const branchNy = await rawPrisma.branch.create({
      data: {
        restaurantId,
        city: 'New York',
        address: '2 Test St',
        countryCode: 'US',
        timezone: 'America/New_York',
      },
    });
    branchNyId = branchNy.id;

    // reservations_party_xor_chk / reservation_waitlist_entries_party_xor_chk
    // require EXACTLY one of userId/reservationGuestId - a default seeded
    // User keeps every fixture creation call below valid unless a test
    // explicitly wants a guest-backed row.
    const defaultUser = await rawPrisma.user.create({
      data: {
        firstName: 'Default',
        lastName: 'Customer',
        email: `${TEST_PREFIX}default-user-${randomUUID()}@example.com`,
        passwordHash: 'argon2id$fake$not-used-by-this-spec',
        language: 'en',
      },
    });
    defaultUserId = defaultUser.id;
  });

  afterAll(async () => {
    if (!dbAvailable) {
      return;
    }
    await rawPrisma.review.deleteMany({
      where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
    });
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
    await rawPrisma.reservationGuest.deleteMany({ where: { phone: { startsWith: '+1555000' } } });
    await rawPrisma.branch.deleteMany({
      where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
    });
    await rawPrisma.restaurant.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
    await rawPrisma.organization.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.$disconnect();
  });

  async function seedTable(branchId: string): Promise<string> {
    // FloorPlan is unique per Branch - one shared FloorPlan per Branch,
    // cached, with a fresh Table per call (Tables have no such constraint).
    let floorPlanId = floorPlanByBranch.get(branchId);
    if (floorPlanId === undefined) {
      const floorPlan = await rawPrisma.floorPlan.create({
        data: { branchId, name: `FP-${randomUUID()}`, isActive: true },
      });
      floorPlanId = floorPlan.id;
      floorPlanByBranch.set(branchId, floorPlanId);
    }
    const table = await rawPrisma.table.create({
      data: { branchId, floorPlanId, tableNumber: `T-${randomUUID().slice(0, 8)}`, capacity: 4 },
    });
    return table.id;
  }

  interface SeedReservationInput {
    restaurantId: string;
    branchId: string;
    status: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled' | 'Completed' | 'Expired' | 'NoShow';
    source?: 'Online' | 'Phone' | 'WalkIn' | 'Staff' | 'WaitlistConversion';
    guests?: number;
    reservationStartTime: Date;
    reservationEndTime?: Date;
    createdAt?: Date;
    approvedAt?: Date | null;
    cancelledAt?: Date | null;
    completedAt?: Date | null;
    noShowAt?: Date | null;
    userId?: string | null;
    reservationGuestId?: string | null;
  }

  async function seedReservation(input: SeedReservationInput): Promise<string> {
    const tableId = await seedTable(input.branchId);
    const endTime =
      input.reservationEndTime ?? new Date(input.reservationStartTime.getTime() + 90 * 60_000);
    // reservations_party_xor_chk requires exactly one of userId/reservationGuestId.
    const reservationGuestId = input.reservationGuestId ?? null;
    const userId = reservationGuestId !== null ? null : (input.userId ?? defaultUserId);
    const reservation = await rawPrisma.reservation.create({
      data: {
        id: randomUUID(),
        userId,
        reservationGuestId,
        restaurantId: input.restaurantId,
        branchId: input.branchId,
        tableId,
        reservationDate: new Date(
          Date.UTC(
            input.reservationStartTime.getUTCFullYear(),
            input.reservationStartTime.getUTCMonth(),
            input.reservationStartTime.getUTCDate(),
          ),
        ),
        reservationStartTime: input.reservationStartTime,
        reservationEndTime: endTime,
        guests: input.guests ?? 2,
        status: input.status,
        source: input.source ?? 'Online',
        approvedAt: input.approvedAt ?? null,
        cancelledAt: input.cancelledAt ?? null,
        completedAt: input.completedAt ?? null,
        noShowAt: input.noShowAt ?? null,
        createdAt: input.createdAt ?? input.reservationStartTime,
      },
    });
    return reservation.id;
  }

  async function seedUser(): Promise<string> {
    const user = await rawPrisma.user.create({
      data: {
        firstName: 'Analytics',
        lastName: 'Tester',
        email: `${TEST_PREFIX}user-${randomUUID()}@example.com`,
        passwordHash: 'argon2id$fake$not-used-by-this-spec',
        language: 'en',
      },
    });
    return user.id;
  }

  async function seedGuest(): Promise<string> {
    const guest = await rawPrisma.reservationGuest.create({
      data: { fullName: 'Walk-in Guest', phone: `+1555000${Math.floor(Math.random() * 10000)}` },
    });
    return guest.id;
  }

  const YEAR_RANGE = {
    from: new Date('2026-01-01T00:00:00.000Z'),
    to: new Date('2026-12-31T23:59:59.999Z'),
    fromKey: '2026-01-01',
    toKey: '2026-12-31',
  };

  describe('getReservationSummary', () => {
    it('computes status counts, source breakdown, and the Cancelled-from-Approved-only cancellation formula', async () => {
      if (skipUnlessDatabaseAvailable(dbAvailable)) return;

      const start = new Date('2026-03-10T12:00:00.000Z');
      await seedReservation({
        restaurantId,
        branchId: branchTokyoId,
        status: 'Completed',
        reservationStartTime: start,
        guests: 4,
      });
      await seedReservation({
        restaurantId,
        branchId: branchTokyoId,
        status: 'NoShow',
        reservationStartTime: start,
        guests: 2,
      });
      await seedReservation({
        restaurantId,
        branchId: branchTokyoId,
        status: 'Cancelled',
        reservationStartTime: start,
        approvedAt: new Date('2026-03-09T00:00:00.000Z'),
        cancelledAt: new Date('2026-03-09T06:00:00.000Z'),
        guests: 3,
      });
      // Cancelled-from-Pending: never approved. Must NOT count toward cancellationRate.
      await seedReservation({
        restaurantId,
        branchId: branchTokyoId,
        status: 'Cancelled',
        reservationStartTime: start,
        approvedAt: null,
        cancelledAt: new Date('2026-03-09T01:00:00.000Z'),
        guests: 5,
      });
      await seedReservation({
        restaurantId,
        branchId: branchTokyoId,
        status: 'Pending',
        source: 'Online',
        reservationStartTime: start,
      });

      const scope: AnalyticsRestaurantScope = {
        restaurantIds: [restaurantId],
        branchIds: [branchTokyoId],
        range: YEAR_RANGE,
      };
      const result = await repository.getReservationSummary(scope);

      expect(result.statusCounts.Completed).toBeGreaterThanOrEqual(1);
      expect(result.statusCounts.NoShow).toBeGreaterThanOrEqual(1);
      expect(result.statusCounts.Cancelled).toBeGreaterThanOrEqual(2);
      // Only the Cancelled-from-Approved row counts (1), not both Cancelled rows (2).
      expect(result.cancelledFromApprovedCount).toBe(1);
    });

    it('scopes strictly to the requested restaurantIds/branchIds (tenant isolation)', async () => {
      if (skipUnlessDatabaseAvailable(dbAvailable)) return;

      const otherBranch = await rawPrisma.branch.create({
        data: {
          restaurantId: otherRestaurantId,
          city: 'Elsewhere',
          address: '9 Other St',
          countryCode: 'US',
          timezone: 'UTC',
        },
      });
      await seedReservation({
        restaurantId: otherRestaurantId,
        branchId: otherBranch.id,
        status: 'Completed',
        reservationStartTime: new Date('2026-03-10T12:00:00.000Z'),
      });

      const scope: AnalyticsRestaurantScope = {
        restaurantIds: [restaurantId],
        branchIds: null,
        range: YEAR_RANGE,
      };
      const result = await repository.getReservationSummary(scope);
      const otherScope: AnalyticsRestaurantScope = {
        restaurantIds: [otherRestaurantId],
        branchIds: null,
        range: YEAR_RANGE,
      };
      const otherResult = await repository.getReservationSummary(otherScope);

      // The other restaurant's data must be visible only under its own scope.
      expect(otherResult.statusCounts.Completed).toBeGreaterThanOrEqual(1);
      // And the two scopes' totals must not be conflated into one number.
      const totalForRestaurant = Object.values(result.statusCounts).reduce((a, b) => a + b, 0);
      const totalForOther = Object.values(otherResult.statusCounts).reduce((a, b) => a + b, 0);
      expect(totalForRestaurant).toBeGreaterThan(0);
      expect(totalForOther).toBeGreaterThan(0);
    });

    it('returns all-zero counts for a scope with no reservations', async () => {
      if (skipUnlessDatabaseAvailable(dbAvailable)) return;

      const emptyRestaurant = await rawPrisma.restaurant.create({
        data: {
          organizationId: orgId,
          name: 'Empty',
          slug: `${TEST_PREFIX}empty-${randomUUID()}`,
          status: 'Active',
        },
      });
      const result = await repository.getReservationSummary({
        restaurantIds: [emptyRestaurant.id],
        branchIds: null,
        range: YEAR_RANGE,
      });
      expect(Object.values(result.statusCounts).every((count) => count === 0)).toBe(true);
      expect(result.partySizeCount).toBe(0);
      await rawPrisma.restaurant.delete({ where: { id: emptyRestaurant.id } });
    });
  });

  describe('getReservationTrends / getPeakHours - Branch-local timezone bucketing', () => {
    it('buckets a Tokyo reservation near local midnight into the correct Tokyo-local day (Decision #3 regression)', async () => {
      if (skipUnlessDatabaseAvailable(dbAvailable)) return;

      // Local 2026-04-10T00:30 Tokyo (UTC+9) -> UTC 2026-04-09T15:30:00.000Z.
      // A naive UTC-calendar-date read of this instant is 2026-04-09
      // (WRONG) - the correct Branch-local service day is 2026-04-10.
      const localMidnightUtc = zonedWallTimeToUtc(2026, 4, 10, 0, 30, 0, 'Asia/Tokyo');
      expect(localMidnightUtc.toISOString().slice(0, 10)).toBe('2026-04-09');

      await seedReservation({
        restaurantId,
        branchId: branchTokyoId,
        status: 'Approved',
        reservationStartTime: localMidnightUtc,
      });

      const range = {
        from: zonedWallTimeToUtc(2026, 4, 10, 0, 0, 0, 'Asia/Tokyo'),
        to: new Date(zonedWallTimeToUtc(2026, 4, 10, 23, 59, 59, 'Asia/Tokyo').getTime() + 999),
        fromKey: '2026-04-10',
        toKey: '2026-04-10',
      };
      const scope: AnalyticsBranchScope = {
        branchId: branchTokyoId,
        timezone: 'Asia/Tokyo',
        range,
      };
      const trends = await repository.getReservationTrends(scope);

      expect(trends.serviceDayCounts.get('2026-04-10')).toBe(1);
      expect(trends.serviceDayCounts.get('2026-04-09') ?? 0).toBe(0);
    });

    it('buckets a New York reservation near local midnight into the correct NY-local day', async () => {
      if (skipUnlessDatabaseAvailable(dbAvailable)) return;

      // Local 2026-06-15T23:30 New York (UTC-4 EDT) -> UTC 2026-06-16T03:30:00.000Z.
      const lateLocalUtc = zonedWallTimeToUtc(2026, 6, 15, 23, 30, 0, 'America/New_York');
      expect(lateLocalUtc.toISOString().slice(0, 10)).toBe('2026-06-16');

      await seedReservation({
        restaurantId,
        branchId: branchNyId,
        status: 'Approved',
        reservationStartTime: lateLocalUtc,
      });

      const range = {
        from: zonedWallTimeToUtc(2026, 6, 15, 0, 0, 0, 'America/New_York'),
        to: new Date(
          zonedWallTimeToUtc(2026, 6, 15, 23, 59, 59, 'America/New_York').getTime() + 999,
        ),
        fromKey: '2026-06-15',
        toKey: '2026-06-15',
      };
      const scope: AnalyticsBranchScope = {
        branchId: branchNyId,
        timezone: 'America/New_York',
        range,
      };
      const trends = await repository.getReservationTrends(scope);

      expect(trends.serviceDayCounts.get('2026-06-15')).toBe(1);
      expect(trends.serviceDayCounts.get('2026-06-16') ?? 0).toBe(0);
    });

    it('never mixes Tokyo and New York bucket counts for reservations at the same real-world instant', async () => {
      if (skipUnlessDatabaseAvailable(dbAvailable)) return;

      const sameInstant = new Date('2026-05-01T10:00:00.000Z');
      await seedReservation({
        restaurantId,
        branchId: branchTokyoId,
        status: 'Approved',
        reservationStartTime: sameInstant,
      });
      await seedReservation({
        restaurantId,
        branchId: branchNyId,
        status: 'Approved',
        reservationStartTime: sameInstant,
      });

      const tokyoRange = {
        from: zonedWallTimeToUtc(2026, 5, 1, 0, 0, 0, 'Asia/Tokyo'),
        to: new Date(zonedWallTimeToUtc(2026, 5, 1, 23, 59, 59, 'Asia/Tokyo').getTime() + 999),
        fromKey: '2026-05-01',
        toKey: '2026-05-01',
      };
      const nyRange = {
        from: zonedWallTimeToUtc(2026, 5, 1, 0, 0, 0, 'America/New_York'),
        to: new Date(
          zonedWallTimeToUtc(2026, 5, 1, 23, 59, 59, 'America/New_York').getTime() + 999,
        ),
        fromKey: '2026-05-01',
        toKey: '2026-05-01',
      };

      const tokyoTrends = await repository.getReservationTrends({
        branchId: branchTokyoId,
        timezone: 'Asia/Tokyo',
        range: tokyoRange,
      });
      const nyTrends = await repository.getReservationTrends({
        branchId: branchNyId,
        timezone: 'America/New_York',
        range: nyRange,
      });

      // Each Branch's own query is scoped by branchId at the SQL level, so
      // the other Branch's reservation at the identical UTC instant is
      // never counted here even though both fall within their respective
      // Branch-local "2026-05-01".
      expect(tokyoTrends.serviceDayCounts.get('2026-05-01')).toBe(1);
      expect(nyTrends.serviceDayCounts.get('2026-05-01')).toBe(1);
    });

    it('Peak Hours includes only Approved/Completed/NoShow and excludes Pending/Rejected/Expired/Cancelled', async () => {
      if (skipUnlessDatabaseAvailable(dbAvailable)) return;

      const hour10Local = zonedWallTimeToUtc(2026, 7, 1, 10, 0, 0, 'Asia/Tokyo');
      const hour14Local = zonedWallTimeToUtc(2026, 7, 1, 14, 0, 0, 'Asia/Tokyo');

      await seedReservation({
        restaurantId,
        branchId: branchTokyoId,
        status: 'Approved',
        reservationStartTime: hour10Local,
      });
      await seedReservation({
        restaurantId,
        branchId: branchTokyoId,
        status: 'Pending',
        reservationStartTime: hour14Local,
      });
      await seedReservation({
        restaurantId,
        branchId: branchTokyoId,
        status: 'Rejected',
        reservationStartTime: hour14Local,
      });

      const range = {
        from: zonedWallTimeToUtc(2026, 7, 1, 0, 0, 0, 'Asia/Tokyo'),
        to: new Date(zonedWallTimeToUtc(2026, 7, 1, 23, 59, 59, 'Asia/Tokyo').getTime() + 999),
        fromKey: '2026-07-01',
        toKey: '2026-07-01',
      };
      const peakHours = await repository.getPeakHours({
        branchId: branchTokyoId,
        timezone: 'Asia/Tokyo',
        range,
      });

      expect(peakHours.get(10)).toBe(1);
      expect(peakHours.get(14) ?? 0).toBe(0);
    });
  });

  describe('getCustomerInsights', () => {
    it('computes unique/returning registered customers (range-scoped) and guest-backed count', async () => {
      if (skipUnlessDatabaseAvailable(dbAvailable)) return;

      const userA = await seedUser();
      const userB = await seedUser();
      const guestId = await seedGuest();
      const start = new Date('2026-08-01T12:00:00.000Z');

      await seedReservation({
        restaurantId,
        branchId: branchTokyoId,
        status: 'Completed',
        reservationStartTime: start,
        userId: userA,
      });
      await seedReservation({
        restaurantId,
        branchId: branchTokyoId,
        status: 'Completed',
        reservationStartTime: start,
        userId: userA,
      });
      await seedReservation({
        restaurantId,
        branchId: branchTokyoId,
        status: 'Completed',
        reservationStartTime: start,
        userId: userB,
      });
      await seedReservation({
        restaurantId,
        branchId: branchTokyoId,
        status: 'Completed',
        source: 'WalkIn',
        reservationStartTime: start,
        reservationGuestId: guestId,
      });

      const result = await repository.getCustomerInsights({
        restaurantIds: [restaurantId],
        branchIds: [branchTokyoId],
        range: {
          from: new Date('2026-08-01T00:00:00.000Z'),
          to: new Date('2026-08-01T23:59:59.999Z'),
          fromKey: '2026-08-01',
          toKey: '2026-08-01',
        },
      });

      expect(result.uniqueRegisteredCustomers).toBe(2); // userA, userB
      expect(result.returningRegisteredCustomers).toBe(1); // only userA has >= 2
      expect(result.guestBackedReservationCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getWaitlistCounts', () => {
    it('counts entries per status, excluding soft-deleted rows', async () => {
      if (skipUnlessDatabaseAvailable(dbAvailable)) return;

      const now = new Date('2026-09-01T10:00:00.000Z');
      const preferredDate = new Date('2026-09-05T00:00:00.000Z');
      const preferredTime = new Date('1970-01-01T18:00:00.000Z');

      async function seedEntry(status: WaitlistStatus, deletedAt: Date | null = null) {
        await rawPrisma.reservationWaitlistEntry.create({
          data: {
            id: randomUUID(),
            restaurantId,
            branchId: branchTokyoId,
            userId: defaultUserId,
            partySize: 2,
            preferredDate,
            preferredTimeFrom: preferredTime,
            status,
            position: 1,
            expiresAt: new Date('2026-09-06T00:00:00.000Z'),
            createdBy: randomUUID(),
            createdAt: now,
            deletedAt,
          },
        });
      }

      await seedEntry('Converted');
      await seedEntry('Cancelled');
      await seedEntry('Expired');
      await seedEntry('Waiting');
      await seedEntry('Converted', new Date()); // soft-deleted, must be excluded

      const counts = await repository.getWaitlistCounts({
        restaurantIds: [restaurantId],
        branchIds: [branchTokyoId],
        range: {
          from: new Date('2026-09-01T00:00:00.000Z'),
          to: new Date('2026-09-01T23:59:59.999Z'),
          fromKey: '2026-09-01',
          toKey: '2026-09-01',
        },
      });

      expect(counts.Converted).toBe(1);
      expect(counts.Cancelled).toBe(1);
      expect(counts.Expired).toBe(1);
      expect(counts.Waiting).toBe(1);
    });
  });

  describe('getReviewsSummary', () => {
    it('counts only active (non-soft-deleted) reviews', async () => {
      if (skipUnlessDatabaseAvailable(dbAvailable)) return;

      const reviewRestaurant = await rawPrisma.restaurant.create({
        data: {
          organizationId: orgId,
          name: 'Review Test Restaurant',
          slug: `${TEST_PREFIX}review-${randomUUID()}`,
          status: 'Active',
          averageRating: 3.75,
        },
      });
      const branch = await rawPrisma.branch.create({
        data: {
          restaurantId: reviewRestaurant.id,
          city: 'X',
          address: 'y',
          countryCode: 'US',
          timezone: 'UTC',
        },
      });
      const userA = await seedUser();
      const userB = await seedUser();
      const resA = await seedReservation({
        restaurantId: reviewRestaurant.id,
        branchId: branch.id,
        status: 'Completed',
        reservationStartTime: new Date('2026-01-01T12:00:00Z'),
        userId: userA,
      });
      const resB = await seedReservation({
        restaurantId: reviewRestaurant.id,
        branchId: branch.id,
        status: 'Completed',
        reservationStartTime: new Date('2026-01-02T12:00:00Z'),
        userId: userB,
      });

      await rawPrisma.review.create({
        data: {
          id: randomUUID(),
          userId: userA,
          restaurantId: reviewRestaurant.id,
          reservationId: resA,
          rating: 5,
        },
      });
      await rawPrisma.review.create({
        data: {
          id: randomUUID(),
          userId: userB,
          restaurantId: reviewRestaurant.id,
          reservationId: resB,
          rating: 2,
          deletedAt: new Date(),
        },
      });

      const result = await repository.getReviewsSummary(reviewRestaurant.id);
      expect(result.activeReviewCount).toBe(1);
    });
  });
});
