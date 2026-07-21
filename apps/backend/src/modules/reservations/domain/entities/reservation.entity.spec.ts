import { Reservation } from './reservation.entity';
import { ReservationSource, ReservationStatus } from '../enums/reservation.enums';
import { InvalidReservationTimeException } from '../exceptions/invalid-reservation-time.exception';
import { InvalidReservationException } from '../exceptions/invalid-reservation.exception';
import { PartySizeExceedsCapacityException } from '../exceptions/party-size-exceeds-capacity.exception';

describe('Reservation entity', () => {
  const now = new Date('2026-08-01T10:00:00.000Z');
  const startTime = new Date('2026-08-01T18:00:00.000Z');
  const endTime = new Date('2026-08-01T19:30:00.000Z');

  function baseProps(overrides: Partial<Parameters<typeof Reservation.create>[0]> = {}) {
    return {
      id: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
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
});
