import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaOfferImpactReader } from '@modules/offers/infrastructure/persistence/prisma-offer-impact.reader';
import {
  ReservationSource,
  ReservationStatus,
} from '@modules/reservations/domain/enums/reservation.enums';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'offer-impact-';

/**
 * ADR-047: the impact card's raw SQL against real Postgres - offer booking
 * counts with the new-guest share, slot counts read in the branch's local
 * day and hour, and attended value per currency from the reference price.
 */
describe('PrismaOfferImpactReader (integration)', () => {
  let dbAvailable = false;
  let reader: PrismaOfferImpactReader;
  let orgId: string;
  let slot = 0;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }
    const moduleRef = await createPrismaIntegrationModule([PrismaOfferImpactReader]);
    reader = moduleRef.get(PrismaOfferImpactReader);
    const org = await rawPrisma.organization.create({
      data: {
        name: 'Offer Impact Test Org',
        slug: `${TEST_PREFIX}org-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}@example.com`,
      },
    });
    orgId = org.id;
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    const restaurant = { slug: { startsWith: TEST_PREFIX } };
    await rawPrisma.reservation.deleteMany({ where: { restaurant } });
    await rawPrisma.offer.deleteMany({ where: { restaurant } });
    await rawPrisma.table.deleteMany({ where: { branch: { restaurant } } });
    await rawPrisma.floorPlan.deleteMany({ where: { branch: { restaurant } } });
    await rawPrisma.branch.deleteMany({ where: { restaurant } });
    await rawPrisma.restaurant.deleteMany({ where: restaurant });
    await rawPrisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
    await rawPrisma.organization.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.$disconnect();
  });

  async function seedVenue(referencePrice: number | null) {
    const restaurant = await rawPrisma.restaurant.create({
      data: {
        organizationId: orgId,
        name: 'Impact Test',
        slug: `${TEST_PREFIX}${randomUUID()}`,
        status: 'Active',
      },
    });
    const branch = await rawPrisma.branch.create({
      data: {
        restaurantId: restaurant.id,
        city: 'Damascus',
        address: '1 Main St',
        countryCode: 'SY',
        currency: 'SYP',
        timezone: 'Asia/Damascus',
        referencePrice,
      },
    });
    const floorPlan = await rawPrisma.floorPlan.create({
      data: { branchId: branch.id, name: 'Main', isActive: true },
    });
    const table = await rawPrisma.table.create({
      data: { branchId: branch.id, floorPlanId: floorPlan.id, tableNumber: 'T1', capacity: 8 },
    });
    const offer = await rawPrisma.offer.create({
      data: {
        restaurantId: restaurant.id,
        type: 'QuietDays',
        title: 'Quiet Tuesday',
        description: 'Midweek discount.',
        discountType: 'Percentage',
        discountValue: 10,
        startsAt: new Date('2026-08-01T00:00:00.000Z'),
        endsAt: new Date('2026-09-01T00:00:00.000Z'),
        status: 'Published',
      },
    });
    return {
      restaurantId: restaurant.id,
      branchId: branch.id,
      tableId: table.id,
      offerId: offer.id,
    };
  }

  async function seedUser() {
    return rawPrisma.user.create({
      data: {
        firstName: 'Jane',
        lastName: 'Impact',
        email: `${TEST_PREFIX}${randomUUID()}@example.com`,
        phone: `+1555444${Math.floor(Math.random() * 10000)}`,
        passwordHash: 'argon2id$fake$not-used-by-this-spec',
        language: 'en',
      },
    });
  }

  async function seedBooking(params: {
    venue: { restaurantId: string; branchId: string; tableId: string };
    userId: string;
    start?: Date;
    guests?: number;
    status?: ReservationStatus;
    offerId?: string | null;
  }) {
    slot += 1;
    const start = params.start ?? new Date(Date.UTC(2026, 6, 1) + slot * 2 * 60 * 60 * 1000);
    await rawPrisma.reservation.create({
      data: {
        id: randomUUID(),
        userId: params.userId,
        restaurantId: params.venue.restaurantId,
        branchId: params.venue.branchId,
        tableId: params.venue.tableId,
        reservationDate: new Date(start.toISOString().slice(0, 10)),
        reservationStartTime: start,
        reservationEndTime: new Date(start.getTime() + 60 * 60 * 1000),
        guests: params.guests ?? 2,
        status: params.status ?? ReservationStatus.Approved,
        source: ReservationSource.Online,
        offerId: params.offerId ?? null,
      },
    });
  }

  it('counts offer bookings, persons, attended and first-time guests', async () => {
    if (!dbAvailable) return;
    const venue = await seedVenue(50);
    const regular = await seedUser();
    const newcomer = await seedUser();
    await seedBooking({ venue, userId: regular.id });
    await seedBooking({ venue, userId: regular.id, offerId: venue.offerId, guests: 3 });
    await seedBooking({
      venue,
      userId: newcomer.id,
      offerId: venue.offerId,
      guests: 4,
      status: ReservationStatus.Completed,
    });
    await seedBooking({
      venue,
      userId: newcomer.id,
      offerId: venue.offerId,
      status: ReservationStatus.Cancelled,
    });

    await expect(reader.countOfferBookings(venue.offerId)).resolves.toEqual({
      bookings: 2,
      persons: 7,
      attended: 1,
      newCustomerBookings: 1,
    });
    await expect(reader.attendedValueByCurrency(venue.offerId)).resolves.toEqual([
      { currency: 'SYP', attendedBookings: 1, personsTimesReferencePrice: 200, unpricedPersons: 0 },
    ]);
  });

  it("counts slot bookings by the branch's local day and hour", async () => {
    if (!dbAvailable) return;
    const venue = await seedVenue(null);
    const user = await seedUser();
    // Tuesday 2026-08-11: 13:00 and 17:00 Damascus; Wednesday 13:00.
    await seedBooking({ venue, userId: user.id, start: new Date('2026-08-11T10:00:00.000Z') });
    await seedBooking({ venue, userId: user.id, start: new Date('2026-08-11T14:00:00.000Z') });
    await seedBooking({ venue, userId: user.id, start: new Date('2026-08-12T10:00:00.000Z') });

    const count = await reader.countSlotBookings(
      {
        restaurantId: venue.restaurantId,
        branchIds: [],
        daysOfWeek: [2],
        fromMinute: 12 * 60,
        toMinute: 16 * 60,
      },
      new Date('2026-08-10T00:00:00.000Z'),
      new Date('2026-08-17T00:00:00.000Z'),
    );
    expect(count).toBe(1);

    const allDays = await reader.countSlotBookings(
      {
        restaurantId: venue.restaurantId,
        branchIds: [venue.branchId],
        daysOfWeek: [],
        fromMinute: null,
        toMinute: null,
      },
      new Date('2026-08-10T00:00:00.000Z'),
      new Date('2026-08-17T00:00:00.000Z'),
    );
    expect(allDays).toBe(3);
  });
});
