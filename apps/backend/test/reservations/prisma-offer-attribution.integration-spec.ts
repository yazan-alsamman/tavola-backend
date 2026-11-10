import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaOfferAttributionReader } from '@modules/reservations/infrastructure/persistence/prisma-offer-attribution.reader';
import { OfferAttributionBooking } from '@modules/reservations/application/ports/offer-attribution-reader.port';
import {
  ReservationSource,
  ReservationStatus,
} from '@modules/reservations/domain/enums/reservation.enums';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'offer-attribution-';

/**
 * ADR-047: proves `PrismaOfferAttributionReader` against real Postgres - the
 * period/day/hour/branch/party conditions through the shared policy, and the
 * counted ones (booking cap, once per customer) that only the database can
 * answer. Released bookings (rejected/cancelled/expired) never use a place.
 */
describe('PrismaOfferAttributionReader (integration)', () => {
  let dbAvailable = false;
  let reader: PrismaOfferAttributionReader;
  let orgId: string;

  // A Tuesday, 13:30 in Damascus.
  const AT = new Date('2026-08-11T08:00:00.000Z');
  const VISIT = new Date('2026-08-11T10:30:00.000Z');

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }
    const moduleRef = await createPrismaIntegrationModule([PrismaOfferAttributionReader]);
    reader = moduleRef.get(PrismaOfferAttributionReader);
    const org = await rawPrisma.organization.create({
      data: {
        name: 'Offer Attribution Test Org',
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
    await rawPrisma.reservationGuest.deleteMany({ where: { phone: { startsWith: '+1555777' } } });
    await rawPrisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
    await rawPrisma.organization.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.$disconnect();
  });

  async function seedVenue() {
    const restaurant = await rawPrisma.restaurant.create({
      data: {
        organizationId: orgId,
        name: 'Attribution Test',
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
        timezone: 'Asia/Damascus',
      },
    });
    const floorPlan = await rawPrisma.floorPlan.create({
      data: { branchId: branch.id, name: 'Main', isActive: true },
    });
    const table = await rawPrisma.table.create({
      data: { branchId: branch.id, floorPlanId: floorPlan.id, tableNumber: 'T1', capacity: 6 },
    });
    return { restaurantId: restaurant.id, branchId: branch.id, tableId: table.id };
  }

  async function seedOffer(
    restaurantId: string,
    conditions: {
      daysOfWeek?: number[];
      startTime?: string;
      endTime?: string;
      minPartySize?: number;
      bookingCap?: number;
      oncePerCustomer?: boolean;
    } = {},
  ) {
    return rawPrisma.offer.create({
      data: {
        restaurantId,
        type: 'QuietDays',
        title: 'Quiet Tuesday',
        description: 'Midweek discount.',
        discountType: 'Percentage',
        discountValue: 15,
        startsAt: new Date('2026-08-01T00:00:00.000Z'),
        endsAt: new Date('2026-09-01T00:00:00.000Z'),
        status: 'Published',
        ...conditions,
      },
    });
  }

  async function seedUser() {
    return rawPrisma.user.create({
      data: {
        firstName: 'Jane',
        lastName: 'Offer',
        email: `${TEST_PREFIX}${randomUUID()}@example.com`,
        phone: `+1555666${Math.floor(Math.random() * 10000)}`,
        passwordHash: 'argon2id$fake$not-used-by-this-spec',
        language: 'en',
      },
    });
  }

  let bookingSlot = 0;

  /** Each booking gets its own two-hour slot so the overlap guard never trips. */
  async function seedBooking(params: {
    venue: { restaurantId: string; branchId: string; tableId: string };
    offerId: string;
    userId?: string;
    reservationGuestId?: string;
    status?: ReservationStatus;
  }) {
    bookingSlot += 1;
    const start = new Date(Date.UTC(2026, 7, 4, 0, 0) + bookingSlot * 2 * 60 * 60 * 1000);
    const userId = params.userId ?? (params.reservationGuestId ? null : (await seedUser()).id);
    await rawPrisma.reservation.create({
      data: {
        id: randomUUID(),
        userId,
        reservationGuestId: params.reservationGuestId ?? null,
        restaurantId: params.venue.restaurantId,
        branchId: params.venue.branchId,
        tableId: params.venue.tableId,
        reservationDate: new Date('2026-08-04T00:00:00.000Z'),
        reservationStartTime: start,
        reservationEndTime: new Date(start.getTime() + 90 * 60 * 1000),
        guests: 2,
        status: params.status ?? ReservationStatus.Approved,
        source: userId ? ReservationSource.Online : ReservationSource.Phone,
        offerId: params.offerId,
      },
    });
  }

  function booking(
    branchId: string,
    overrides?: Partial<OfferAttributionBooking>,
  ): OfferAttributionBooking {
    return {
      branchId,
      partySize: 2,
      startTime: VISIT,
      timeZone: 'Asia/Damascus',
      userId: null,
      guestPhone: null,
      ...overrides,
    };
  }

  it('attributes a booking that meets the days, hours and party size', async () => {
    if (!dbAvailable) return;
    const venue = await seedVenue();
    const offer = await seedOffer(venue.restaurantId, {
      daysOfWeek: [2],
      startTime: '12:00',
      endTime: '16:00',
      minPartySize: 2,
    });

    await expect(
      reader.findAttributableOfferId(offer.id, venue.restaurantId, AT, booking(venue.branchId)),
    ).resolves.toBe(offer.id);
    await expect(
      reader.findAttributableOfferId(
        offer.id,
        venue.restaurantId,
        AT,
        booking(venue.branchId, { startTime: new Date('2026-08-12T10:30:00.000Z') }),
      ),
    ).resolves.toBeNull();
  });

  it('stops attributing once the booking cap is used, not counting released bookings', async () => {
    if (!dbAvailable) return;
    const venue = await seedVenue();
    const offer = await seedOffer(venue.restaurantId, { bookingCap: 1 });
    await seedBooking({ venue, offerId: offer.id, status: ReservationStatus.Cancelled });

    await expect(
      reader.findAttributableOfferId(offer.id, venue.restaurantId, AT, booking(venue.branchId)),
    ).resolves.toBe(offer.id);

    await seedBooking({ venue, offerId: offer.id });
    await expect(
      reader.findAttributableOfferId(offer.id, venue.restaurantId, AT, booking(venue.branchId)),
    ).resolves.toBeNull();
  });

  it('gives a once-per-customer offer to an app user or a guest phone only once', async () => {
    if (!dbAvailable) return;
    const venue = await seedVenue();
    const offer = await seedOffer(venue.restaurantId, { oncePerCustomer: true });
    const user = await seedUser();
    const guest = await rawPrisma.reservationGuest.create({
      data: { fullName: 'Phone Guest', phone: `+1555777${Math.floor(Math.random() * 10000)}` },
    });
    await seedBooking({ venue, offerId: offer.id, userId: user.id });
    await seedBooking({ venue, offerId: offer.id, reservationGuestId: guest.id });

    await expect(
      reader.findAttributableOfferId(
        offer.id,
        venue.restaurantId,
        AT,
        booking(venue.branchId, { userId: user.id }),
      ),
    ).resolves.toBeNull();
    await expect(
      reader.findAttributableOfferId(
        offer.id,
        venue.restaurantId,
        AT,
        booking(venue.branchId, { guestPhone: guest.phone }),
      ),
    ).resolves.toBeNull();
    await expect(
      reader.findAttributableOfferId(
        offer.id,
        venue.restaurantId,
        AT,
        booking(venue.branchId, { guestPhone: '+15557770000' }),
      ),
    ).resolves.toBe(offer.id);
  });
});
