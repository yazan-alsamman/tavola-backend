import { OfferDiscountType } from '../enums/offer.enums';
import {
  baselineWindowStart,
  estimatedCost,
  liftPercent,
  sharePercent,
  usualBookings,
} from './offer-impact.policy';

describe('offer impact policy (ADR-047)', () => {
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

  it('starts the baseline four weeks before the offer', () => {
    expect(baselineWindowStart(new Date('2026-08-29T00:00:00.000Z'))).toEqual(
      new Date('2026-08-01T00:00:00.000Z'),
    );
  });

  it('scales the four-week baseline to the time the offer has run', () => {
    expect(usualBookings(40, WEEK_MS)).toBe(10);
    expect(usualBookings(10, 3 * 24 * 60 * 60 * 1000)).toBe(1.1);
  });

  it('computes the lift, with nothing to compare when the usual is zero', () => {
    expect(liftPercent(15, 10)).toBe(50);
    expect(liftPercent(5, 10)).toBe(-50);
    expect(liftPercent(5, 0)).toBeNull();
  });

  it('computes a share, null for an empty whole', () => {
    expect(sharePercent(1, 3)).toBe(33);
    expect(sharePercent(0, 0)).toBeNull();
  });

  it('estimates a percentage discount from persons and the reference price', () => {
    expect(
      estimatedCost(OfferDiscountType.Percentage, 20, [
        {
          currency: 'SYP',
          attendedBookings: 3,
          personsTimesReferencePrice: 1000,
          unpricedPersons: 0,
        },
        { currency: 'USD', attendedBookings: 1, personsTimesReferencePrice: 0, unpricedPersons: 2 },
        { currency: 'EUR', attendedBookings: 0, personsTimesReferencePrice: 0, unpricedPersons: 0 },
      ]),
    ).toEqual([
      { currency: 'SYP', amount: 200, partial: false },
      { currency: 'USD', amount: 0, partial: true },
    ]);
  });

  it('estimates a fixed discount per attended booking', () => {
    expect(
      estimatedCost(OfferDiscountType.FixedAmount, 5, [
        { currency: 'USD', attendedBookings: 4, personsTimesReferencePrice: 0, unpricedPersons: 9 },
      ]),
    ).toEqual([{ currency: 'USD', amount: 20, partial: false }]);
  });
});
