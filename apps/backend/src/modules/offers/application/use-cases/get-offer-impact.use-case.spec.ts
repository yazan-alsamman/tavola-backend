import { GetOfferImpactUseCase } from './get-offer-impact.use-case';
import { OfferNotFoundException } from '../../domain/exceptions/offer-not-found.exception';
import {
  OfferAttendedValue,
  OfferBookingCounts,
  OfferImpactReaderPort,
  OfferSlotFilter,
} from '../ports/offer-impact-reader.port';
import { FixedClock } from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryOfferRepository } from '../../../../../test/offers/support/in-memory-offer.repository';
import {
  orgMemberActor,
  testOffer,
  testOfferContent,
  testRestaurant,
} from '../../../../../test/offers/support/offer-test-fixtures';

class StubImpactReader implements OfferImpactReaderPort {
  readonly slotCalls: { filter: OfferSlotFilter; from: Date; to: Date }[] = [];

  constructor(
    private readonly counts: OfferBookingCounts,
    private readonly slotCounts: number[],
    private readonly values: OfferAttendedValue[],
  ) {}

  async countOfferBookings(): Promise<OfferBookingCounts> {
    return this.counts;
  }

  async countSlotBookings(filter: OfferSlotFilter, from: Date, to: Date): Promise<number> {
    this.slotCalls.push({ filter, from, to });
    return this.slotCounts[this.slotCalls.length - 1] ?? 0;
  }

  async attendedValueByCurrency(): Promise<OfferAttendedValue[]> {
    return this.values;
  }
}

describe('GetOfferImpactUseCase (ADR-047)', () => {
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const offerId = '22222222-2222-4222-8222-222222222222';
  // The offer started 2026-08-01; seven days have run.
  const now = new Date('2026-08-08T00:00:00.000Z');

  async function build(reader: StubImpactReader) {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const offerRepository = new InMemoryOfferRepository();
    await restaurantRepository.save(testRestaurant({ id: restaurantId }));
    const useCase = new GetOfferImpactUseCase(
      restaurantRepository,
      offerRepository,
      reader,
      new FixedClock(now),
    );
    return { useCase, offerRepository };
  }

  it('compares bookings in the offer slots with the usual and estimates the cost', async () => {
    const reader = new StubImpactReader(
      { bookings: 12, persons: 30, attended: 8, newCustomerBookings: 3 },
      [15, 40],
      [
        {
          currency: 'SYP',
          attendedBookings: 8,
          personsTimesReferencePrice: 5000,
          unpricedPersons: 0,
        },
      ],
    );
    const { useCase, offerRepository } = await build(reader);
    await offerRepository.seed(
      testOffer({
        id: offerId,
        restaurantId,
        content: testOfferContent({
          startsAt: new Date('2026-08-01T00:00:00.000Z'),
          daysOfWeek: [2],
          startTime: '12:00',
          endTime: '16:00',
        }),
      }).publish(new Date('2026-08-01T00:00:00.000Z')),
    );

    const result = await useCase.execute({ actor: orgMemberActor(), restaurantId, offerId });

    expect(result.newCustomerPercent).toBe(25);
    expect(result.comparison).toMatchObject({
      bookingsInOfferSlots: 15,
      usualBookings: 10,
      liftPercent: 50,
      baselineWeeks: 4,
    });
    expect(result.estimatedCost).toEqual([{ currency: 'SYP', amount: 1000, partial: false }]);
    expect(reader.slotCalls[0].filter).toMatchObject({
      daysOfWeek: [2],
      fromMinute: 720,
      toMinute: 960,
    });
    expect(reader.slotCalls[1].from).toEqual(new Date('2026-07-04T00:00:00.000Z'));
  });

  it('has no comparison before the offer starts', async () => {
    const reader = new StubImpactReader(
      { bookings: 0, persons: 0, attended: 0, newCustomerBookings: 0 },
      [],
      [],
    );
    const { useCase, offerRepository } = await build(reader);
    await offerRepository.seed(
      testOffer({
        id: offerId,
        restaurantId,
        content: testOfferContent({
          startsAt: new Date('2026-08-20T00:00:00.000Z'),
          endsAt: new Date('2026-08-31T00:00:00.000Z'),
        }),
      }),
    );

    const result = await useCase.execute({ actor: orgMemberActor(), restaurantId, offerId });

    expect(result.comparison.usualBookings).toBeNull();
    expect(result.comparison.liftPercent).toBeNull();
    expect(result.newCustomerPercent).toBeNull();
    expect(reader.slotCalls).toHaveLength(0);
  });

  it('404s for an unknown offer', async () => {
    const reader = new StubImpactReader(
      { bookings: 0, persons: 0, attended: 0, newCustomerBookings: 0 },
      [],
      [],
    );
    const { useCase } = await build(reader);
    await expect(
      useCase.execute({ actor: orgMemberActor(), restaurantId, offerId }),
    ).rejects.toBeInstanceOf(OfferNotFoundException);
  });
});
