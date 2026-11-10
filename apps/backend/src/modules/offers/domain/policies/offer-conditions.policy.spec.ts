import {
  OfferBooking,
  OfferConditions,
  localDayAndMinutes,
  minutesOf,
  offerAcceptsBooking,
} from './offer-conditions.policy';

describe('offer conditions policy (ADR-047)', () => {
  const BRANCH = 'bbbbbbbb-0001-4000-8000-000000000001';
  const OTHER_BRANCH = 'bbbbbbbb-0001-4000-8000-000000000002';

  function conditions(overrides?: Partial<OfferConditions>): OfferConditions {
    return {
      startsAt: new Date('2026-08-01T00:00:00.000Z'),
      endsAt: new Date('2026-09-01T00:00:00.000Z'),
      daysOfWeek: [],
      startTime: null,
      endTime: null,
      minPartySize: null,
      branchIds: [],
      ...overrides,
    };
  }

  // 2026-08-11 is a Tuesday; 10:30 UTC is 13:30 in Damascus (UTC+3).
  function booking(overrides?: Partial<OfferBooking>): OfferBooking {
    return {
      branchId: BRANCH,
      partySize: 2,
      startTime: new Date('2026-08-11T10:30:00.000Z'),
      timeZone: 'Asia/Damascus',
      ...overrides,
    };
  }

  it('accepts any booking inside the period when there are no conditions', () => {
    expect(offerAcceptsBooking(conditions(), booking())).toBe(true);
  });

  it('rejects a visit outside [startsAt, endsAt)', () => {
    expect(
      offerAcceptsBooking(
        conditions(),
        booking({ startTime: new Date('2026-09-01T00:00:00.000Z') }),
      ),
    ).toBe(false);
    expect(
      offerAcceptsBooking(
        conditions(),
        booking({ startTime: new Date('2026-07-31T23:59:00.000Z') }),
      ),
    ).toBe(false);
  });

  it('limits to the listed branches', () => {
    expect(offerAcceptsBooking(conditions({ branchIds: [OTHER_BRANCH] }), booking())).toBe(false);
    expect(offerAcceptsBooking(conditions({ branchIds: [BRANCH] }), booking())).toBe(true);
  });

  it('requires the minimum party size', () => {
    expect(offerAcceptsBooking(conditions({ minPartySize: 4 }), booking())).toBe(false);
    expect(offerAcceptsBooking(conditions({ minPartySize: 4 }), booking({ partySize: 4 }))).toBe(
      true,
    );
  });

  it("uses the branch's local weekday", () => {
    expect(offerAcceptsBooking(conditions({ daysOfWeek: [2] }), booking())).toBe(true);
    expect(offerAcceptsBooking(conditions({ daysOfWeek: [3] }), booking())).toBe(false);
    // 22:30 UTC Tuesday is 01:30 Wednesday in Damascus.
    expect(
      offerAcceptsBooking(
        conditions({ daysOfWeek: [3] }),
        booking({ startTime: new Date('2026-08-11T22:30:00.000Z') }),
      ),
    ).toBe(true);
  });

  it('uses the local hours as [start, end)', () => {
    const lunch = conditions({ startTime: '12:00', endTime: '13:30' });
    expect(offerAcceptsBooking(lunch, booking())).toBe(false);
    expect(
      offerAcceptsBooking(lunch, booking({ startTime: new Date('2026-08-11T09:00:00.000Z') })),
    ).toBe(true);
  });

  it('reads local day and minutes', () => {
    expect(localDayAndMinutes(new Date('2026-08-11T21:15:00.000Z'), 'Asia/Damascus')).toEqual({
      dayOfWeek: 3,
      minutes: 15,
    });
  });

  it('parses HH:mm and rejects anything else', () => {
    expect(minutesOf('16:45')).toBe(1005);
    expect(() => minutesOf('24:00')).toThrow();
  });
});
