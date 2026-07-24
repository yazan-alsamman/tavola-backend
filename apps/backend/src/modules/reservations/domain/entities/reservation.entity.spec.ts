import { Reservation } from './reservation.entity';
import { ReservationSource, ReservationStatus } from '../enums/reservation.enums';
import { InvalidReservationTimeException } from '../exceptions/invalid-reservation-time.exception';
import { InvalidReservationException } from '../exceptions/invalid-reservation.exception';
import { PartySizeExceedsCapacityException } from '../exceptions/party-size-exceeds-capacity.exception';
import { InvalidReservationStatusTransitionException } from '../exceptions/invalid-reservation-status-transition.exception';

describe('Reservation entity', () => {
  const now = new Date('2026-08-01T10:00:00.000Z');
  const startTime = new Date('2026-08-01T18:00:00.000Z');
  const endTime = new Date('2026-08-01T19:30:00.000Z');

  function baseProps(overrides: Partial<Parameters<typeof Reservation.create>[0]> = {}) {
    return {
      id: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      reservationGuestId: null,
      source: ReservationSource.Online,
      restaurantId: '33333333-3333-4333-8333-333333333333',
      branchId: '44444444-4444-4444-8444-444444444444',
      tableId: '55555555-5555-4555-8555-555555555555',
      reservationDate: new Date('2026-08-01T00:00:00.000Z'),
      reservationStartTime: startTime,
      reservationEndTime: endTime,
      guests: 4,
      tableCapacity: 4,
      notes: null,
      createdBy: '22222222-2222-4222-8222-222222222222',
      now,
      ...overrides,
    };
  }

  it('creates a Pending, Online reservation unconditionally', () => {
    const reservation = Reservation.create(baseProps());

    expect(reservation.status).toBe(ReservationStatus.Pending);
    expect(reservation.source).toBe(ReservationSource.Online);
    expect(reservation.reservationGuestId).toBeNull();
    expect(reservation.userId?.value).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('rejects a start time that is not in the future', () => {
    expect(() =>
      Reservation.create(baseProps({ reservationStartTime: new Date('2026-08-01T09:00:00.000Z') })),
    ).toThrow(InvalidReservationTimeException);
  });

  it('rejects reservationEndTime at or before reservationStartTime', () => {
    expect(() => Reservation.create(baseProps({ reservationEndTime: startTime }))).toThrow(
      InvalidReservationTimeException,
    );
  });

  it('rejects a non-positive guests value', () => {
    expect(() => Reservation.create(baseProps({ guests: 0 }))).toThrow(InvalidReservationException);
  });

  it('rejects party size exceeding table capacity', () => {
    expect(() => Reservation.create(baseProps({ guests: 5, tableCapacity: 4 }))).toThrow(
      PartySizeExceedsCapacityException,
    );
  });

  it('allows party size exactly equal to table capacity', () => {
    const reservation = Reservation.create(baseProps({ guests: 4, tableCapacity: 4 }));
    expect(reservation.guests).toBe(4);
  });

  describe('reservation-party invariant (Phase 7.4 decision #5)', () => {
    it('creates a Phone/WalkIn reservation with reservationGuestId set and userId null', () => {
      const reservation = Reservation.create(
        baseProps({
          userId: null,
          reservationGuestId: '66666666-6666-4666-8666-666666666666',
          source: ReservationSource.Phone,
        }),
      );

      expect(reservation.userId).toBeNull();
      expect(reservation.reservationGuestId).toBe('66666666-6666-4666-8666-666666666666');
      expect(reservation.source).toBe(ReservationSource.Phone);
    });

    it('rejects both userId and reservationGuestId set', () => {
      expect(() =>
        Reservation.create(
          baseProps({ reservationGuestId: '66666666-6666-4666-8666-666666666666' }),
        ),
      ).toThrow(InvalidReservationException);
    });

    it('rejects neither userId nor reservationGuestId set', () => {
      expect(() => Reservation.create(baseProps({ userId: null }))).toThrow(
        InvalidReservationException,
      );
    });

    it('createAutoApproved() enforces the same invariant', () => {
      expect(() =>
        Reservation.createAutoApproved(
          baseProps({ reservationGuestId: '66666666-6666-4666-8666-666666666666' }),
        ),
      ).toThrow(InvalidReservationException);
    });
  });

  describe('createAutoApproved() (Phase 7.2 auto-approval path)', () => {
    it('is born Approved directly, never Pending, with approvedBy null and approvedAt = now', () => {
      const reservation = Reservation.createAutoApproved(baseProps());

      expect(reservation.status).toBe(ReservationStatus.Approved);
      expect(reservation.approvedBy).toBeNull();
      expect(reservation.approvedAt).toEqual(now);
    });

    it('still enforces the same creation-time validation as create()', () => {
      expect(() =>
        Reservation.createAutoApproved(baseProps({ guests: 5, tableCapacity: 4 })),
      ).toThrow(PartySizeExceedsCapacityException);
    });
  });

  describe('approve() (Phase 7.2)', () => {
    it('transitions Pending -> Approved, recording approvedBy/approvedAt', () => {
      const reservation = Reservation.create(baseProps());
      const approvedAt = new Date('2026-08-01T11:00:00.000Z');

      const approved = reservation.approve('employee-1', approvedAt);

      expect(approved.status).toBe(ReservationStatus.Approved);
      expect(approved.approvedBy).toBe('employee-1');
      expect(approved.approvedAt).toEqual(approvedAt);
      expect(approved.updatedAt).toEqual(approvedAt);
    });

    it.each([
      ReservationStatus.Approved,
      ReservationStatus.Rejected,
      ReservationStatus.Cancelled,
      ReservationStatus.Completed,
      ReservationStatus.Expired,
      ReservationStatus.NoShow,
    ])('rejects approving a reservation that is already %s', (status) => {
      const reservation = Reservation.reconstitute({
        ...Reservation.create(baseProps()).toProps(),
        status,
      });

      expect(() => reservation.approve('employee-1', now)).toThrow(
        InvalidReservationStatusTransitionException,
      );
    });
  });

  describe('reject() (Phase 7.2, manual)', () => {
    it('transitions Pending -> Rejected without touching notes', () => {
      const reservation = Reservation.create(baseProps({ notes: 'Window seat please' }));
      const rejectedAt = new Date('2026-08-01T11:00:00.000Z');

      const rejected = reservation.reject(rejectedAt);

      expect(rejected.status).toBe(ReservationStatus.Rejected);
      expect(rejected.notes).toBe('Window seat please');
      expect(rejected.updatedAt).toEqual(rejectedAt);
    });

    it.each([
      ReservationStatus.Approved,
      ReservationStatus.Rejected,
      ReservationStatus.Cancelled,
      ReservationStatus.Completed,
      ReservationStatus.Expired,
      ReservationStatus.NoShow,
    ])('rejects rejecting a reservation that is already %s', (status) => {
      const reservation = Reservation.reconstitute({
        ...Reservation.create(baseProps()).toProps(),
        status,
      });

      expect(() => reservation.reject(now)).toThrow(InvalidReservationStatusTransitionException);
    });
  });

  describe('autoReject() (Phase 7.2, automatic)', () => {
    it('transitions Pending -> Rejected and appends a system note to empty notes', () => {
      const reservation = Reservation.create(baseProps({ notes: null }));
      const rejectedAt = new Date('2026-08-01T11:00:00.000Z');

      const rejected = reservation.autoReject(
        rejectedAt,
        'Automatically rejected: table approved for an overlapping reservation.',
      );

      expect(rejected.status).toBe(ReservationStatus.Rejected);
      expect(rejected.notes).toBe(
        'Automatically rejected: table approved for an overlapping reservation.',
      );
    });

    it('appends the system note to existing customer notes rather than overwriting them', () => {
      const reservation = Reservation.create(baseProps({ notes: 'Window seat please' }));

      const rejected = reservation.autoReject(now, 'Automatically rejected.');

      expect(rejected.notes).toBe('Window seat please\nAutomatically rejected.');
    });

    it('rejects auto-rejecting a reservation that is not Pending', () => {
      const reservation = Reservation.reconstitute({
        ...Reservation.create(baseProps()).toProps(),
        status: ReservationStatus.Approved,
      });

      expect(() => reservation.autoReject(now, 'note')).toThrow(
        InvalidReservationStatusTransitionException,
      );
    });
  });

  describe('cancel() (Phase 7.3)', () => {
    it.each([ReservationStatus.Pending, ReservationStatus.Approved])(
      'transitions %s -> Cancelled, recording cancelledAt',
      (status) => {
        const reservation = Reservation.reconstitute({
          ...Reservation.create(baseProps()).toProps(),
          status,
        });
        const cancelledAt = new Date('2026-08-01T11:00:00.000Z');

        const cancelled = reservation.cancel(cancelledAt);

        expect(cancelled.status).toBe(ReservationStatus.Cancelled);
        expect(cancelled.cancelledAt).toEqual(cancelledAt);
        expect(cancelled.updatedAt).toEqual(cancelledAt);
      },
    );

    it.each([
      ReservationStatus.Rejected,
      ReservationStatus.Cancelled,
      ReservationStatus.Completed,
      ReservationStatus.Expired,
      ReservationStatus.NoShow,
    ])('rejects cancelling a reservation that is already %s', (status) => {
      const reservation = Reservation.reconstitute({
        ...Reservation.create(baseProps()).toProps(),
        status,
      });

      expect(() => reservation.cancel(now)).toThrow(InvalidReservationStatusTransitionException);
    });
  });

  describe('complete() (Phase 7.3)', () => {
    it('transitions Approved -> Completed once the service window has begun', () => {
      const reservation = Reservation.reconstitute({
        ...Reservation.create(baseProps()).toProps(),
        status: ReservationStatus.Approved,
      });

      const completed = reservation.complete(startTime);

      expect(completed.status).toBe(ReservationStatus.Completed);
      expect(completed.completedAt).toEqual(startTime);
    });

    it('rejects completing before the scheduled service window has begun', () => {
      const reservation = Reservation.reconstitute({
        ...Reservation.create(baseProps()).toProps(),
        status: ReservationStatus.Approved,
      });

      expect(() => reservation.complete(now)).toThrow(InvalidReservationTimeException);
    });

    it.each([
      ReservationStatus.Pending,
      ReservationStatus.Rejected,
      ReservationStatus.Cancelled,
      ReservationStatus.Completed,
      ReservationStatus.Expired,
      ReservationStatus.NoShow,
    ])('rejects completing a reservation that is %s (not Approved)', (status) => {
      const reservation = Reservation.reconstitute({
        ...Reservation.create(baseProps()).toProps(),
        status,
      });

      expect(() => reservation.complete(endTime)).toThrow(
        InvalidReservationStatusTransitionException,
      );
    });
  });

  describe('markNoShow() (Phase 7.3)', () => {
    it('transitions Approved -> NoShow once the scheduled time has passed', () => {
      const reservation = Reservation.reconstitute({
        ...Reservation.create(baseProps()).toProps(),
        status: ReservationStatus.Approved,
      });

      const noShow = reservation.markNoShow(startTime);

      expect(noShow.status).toBe(ReservationStatus.NoShow);
      expect(noShow.noShowAt).toEqual(startTime);
    });

    it('rejects marking NoShow before the scheduled time has passed', () => {
      const reservation = Reservation.reconstitute({
        ...Reservation.create(baseProps()).toProps(),
        status: ReservationStatus.Approved,
      });

      expect(() => reservation.markNoShow(now)).toThrow(InvalidReservationTimeException);
    });

    it('rejects marking NoShow on a Pending reservation', () => {
      const reservation = Reservation.create(baseProps());

      expect(() => reservation.markNoShow(endTime)).toThrow(
        InvalidReservationStatusTransitionException,
      );
    });
  });

  describe('expire() (Phase 7.3)', () => {
    it('transitions Pending -> Expired', () => {
      const reservation = Reservation.create(baseProps());

      const expired = reservation.expire(now);

      expect(expired.status).toBe(ReservationStatus.Expired);
    });

    it('rejects expiring an Approved reservation (Approved -> Expired does not exist)', () => {
      const reservation = Reservation.reconstitute({
        ...Reservation.create(baseProps()).toProps(),
        status: ReservationStatus.Approved,
      });

      expect(() => reservation.expire(now)).toThrow(InvalidReservationStatusTransitionException);
    });
  });

  describe('reschedule() (Phase 7.3)', () => {
    const newStartTime = new Date('2026-08-02T19:00:00.000Z');
    const newEndTime = new Date('2026-08-02T20:30:00.000Z');
    const newTableId = '99999999-9999-4999-8999-999999999999';

    it.each([ReservationStatus.Pending, ReservationStatus.Approved])(
      'reschedules a %s reservation in place - same id, status unchanged',
      (status) => {
        const reservation = Reservation.reconstitute({
          ...Reservation.create(baseProps()).toProps(),
          status,
        });

        const rescheduled = reservation.reschedule({
          tableId: newTableId,
          reservationDate: new Date('2026-08-02T00:00:00.000Z'),
          reservationStartTime: newStartTime,
          reservationEndTime: newEndTime,
          guests: 3,
          tableCapacity: 4,
          now,
        });

        expect(rescheduled.reservationId.value).toBe(reservation.reservationId.value);
        expect(rescheduled.status).toBe(status);
        expect(rescheduled.tableId.value).toBe(newTableId);
        expect(rescheduled.reservationStartTime).toEqual(newStartTime);
        expect(rescheduled.reservationEndTime).toEqual(newEndTime);
        expect(rescheduled.guests).toBe(3);
        expect(rescheduled.updatedAt).toEqual(now);
      },
    );

    it('rejects rescheduling to an end time at or before the new start time', () => {
      const reservation = Reservation.create(baseProps());

      expect(() =>
        reservation.reschedule({
          tableId: newTableId,
          reservationDate: new Date('2026-08-02T00:00:00.000Z'),
          reservationStartTime: newStartTime,
          reservationEndTime: newStartTime,
          guests: 2,
          tableCapacity: 4,
          now,
        }),
      ).toThrow(InvalidReservationTimeException);
    });

    it('rejects rescheduling guests beyond the target table capacity', () => {
      const reservation = Reservation.create(baseProps());

      expect(() =>
        reservation.reschedule({
          tableId: newTableId,
          reservationDate: new Date('2026-08-02T00:00:00.000Z'),
          reservationStartTime: newStartTime,
          reservationEndTime: newEndTime,
          guests: 5,
          tableCapacity: 4,
          now,
        }),
      ).toThrow(PartySizeExceedsCapacityException);
    });

    it.each([
      ReservationStatus.Rejected,
      ReservationStatus.Cancelled,
      ReservationStatus.Completed,
      ReservationStatus.Expired,
      ReservationStatus.NoShow,
    ])('rejects rescheduling a reservation that is %s (terminal)', (status) => {
      const reservation = Reservation.reconstitute({
        ...Reservation.create(baseProps()).toProps(),
        status,
      });

      expect(() =>
        reservation.reschedule({
          tableId: newTableId,
          reservationDate: new Date('2026-08-02T00:00:00.000Z'),
          reservationStartTime: newStartTime,
          reservationEndTime: newEndTime,
          guests: 2,
          tableCapacity: 4,
          now,
        }),
      ).toThrow(InvalidReservationStatusTransitionException);
    });
  });
});
