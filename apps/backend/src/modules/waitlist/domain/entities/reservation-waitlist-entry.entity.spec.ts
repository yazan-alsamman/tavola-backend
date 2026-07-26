import { ReservationWaitlistEntry } from './reservation-waitlist-entry.entity';
import { WaitlistStatus } from '../enums/waitlist.enums';
import { InvalidWaitlistEntryException } from '../exceptions/invalid-waitlist-entry.exception';
import { InvalidWaitlistStatusTransitionException } from '../exceptions/invalid-waitlist-status-transition.exception';

describe('ReservationWaitlistEntry entity', () => {
  const now = new Date('2026-08-01T10:00:00.000Z');

  function baseProps(
    overrides: Partial<Parameters<typeof ReservationWaitlistEntry.create>[0]> = {},
  ) {
    return {
      id: '11111111-1111-4111-8111-111111111111',
      restaurantId: '33333333-3333-4333-8333-333333333333',
      branchId: '44444444-4444-4444-8444-444444444444',
      userId: '22222222-2222-4222-8222-222222222222',
      reservationGuestId: null,
      partySize: 4,
      preferredDate: new Date('2026-08-01T00:00:00.000Z'),
      preferredTimeFrom: new Date(Date.UTC(1970, 0, 1, 19, 0, 0)),
      preferredTimeTo: null,
      position: 1,
      expiresAt: new Date('2026-08-01T23:59:59.999Z'),
      notes: null,
      createdBy: '22222222-2222-4222-8222-222222222222',
      now,
      ...overrides,
    };
  }

  it('creates a Waiting entry unconditionally', () => {
    const entry = ReservationWaitlistEntry.create(baseProps());
    expect(entry.status).toBe(WaitlistStatus.Waiting);
    expect(entry.convertedReservationId).toBeNull();
    expect(entry.notifiedAt).toBeNull();
  });

  it('rejects a non-positive partySize', () => {
    expect(() => ReservationWaitlistEntry.create(baseProps({ partySize: 0 }))).toThrow(
      InvalidWaitlistEntryException,
    );
  });

  it('rejects both userId and reservationGuestId set', () => {
    expect(() =>
      ReservationWaitlistEntry.create(
        baseProps({
          userId: '22222222-2222-4222-8222-222222222222',
          reservationGuestId: 'guest-1',
        }),
      ),
    ).toThrow(InvalidWaitlistEntryException);
  });

  it('rejects neither userId nor reservationGuestId set', () => {
    expect(() =>
      ReservationWaitlistEntry.create(baseProps({ userId: null, reservationGuestId: null })),
    ).toThrow(InvalidWaitlistEntryException);
  });

  describe('state machine', () => {
    it('allows Waiting -> Notified -> Converted', () => {
      const waiting = ReservationWaitlistEntry.create(baseProps());
      const notified = waiting.notify(now);
      expect(notified.status).toBe(WaitlistStatus.Notified);
      const converted = notified.convert('reservation-1', now);
      expect(converted.status).toBe(WaitlistStatus.Converted);
      expect(converted.convertedReservationId).toBe('reservation-1');
    });

    it('allows Waiting -> Converted directly (notification is not required before promotion)', () => {
      const waiting = ReservationWaitlistEntry.create(baseProps());
      const converted = waiting.convert('reservation-1', now);
      expect(converted.status).toBe(WaitlistStatus.Converted);
    });

    it('allows Waiting -> Cancelled and Waiting -> Expired', () => {
      const waiting = ReservationWaitlistEntry.create(baseProps());
      expect(waiting.cancel(now).status).toBe(WaitlistStatus.Cancelled);
      expect(waiting.expire(now).status).toBe(WaitlistStatus.Expired);
    });

    it('allows Notified -> Cancelled and Notified -> Expired', () => {
      const notified = ReservationWaitlistEntry.create(baseProps()).notify(now);
      expect(notified.cancel(now).status).toBe(WaitlistStatus.Cancelled);
      expect(notified.expire(now).status).toBe(WaitlistStatus.Expired);
    });

    it('rejects re-notifying an already-Notified entry (no path back to Waiting exists)', () => {
      const notified = ReservationWaitlistEntry.create(baseProps()).notify(now);
      expect(() => notified.notify(now)).toThrow(InvalidWaitlistStatusTransitionException);
    });

    it('rejects any transition from a terminal status', () => {
      const cancelled = ReservationWaitlistEntry.create(baseProps()).cancel(now);
      expect(() => cancelled.notify(now)).toThrow(InvalidWaitlistStatusTransitionException);
      expect(() => cancelled.convert('reservation-1', now)).toThrow(
        InvalidWaitlistStatusTransitionException,
      );
      expect(() => cancelled.cancel(now)).toThrow(InvalidWaitlistStatusTransitionException);
      expect(() => cancelled.expire(now)).toThrow(InvalidWaitlistStatusTransitionException);
    });
  });
});
