import { ReservationGuest } from './reservation-guest.entity';
import { InvalidReservationException } from '../exceptions/invalid-reservation.exception';
import { InvalidPhoneNumberException } from '@shared/domain/value-objects/phone-number.vo';

describe('ReservationGuest entity', () => {
  const now = new Date('2026-08-01T10:00:00.000Z');

  function baseProps(overrides: Partial<Parameters<typeof ReservationGuest.create>[0]> = {}) {
    return {
      id: '11111111-1111-4111-8111-111111111111',
      fullName: 'Jane Guest',
      countryCode: 'SY',
      phoneNumber: '0912345678',
      email: null,
      now,
      ...overrides,
    };
  }

  it('creates a guest with canonical E.164 phone and no anonymizedAt', () => {
    const guest = ReservationGuest.create(baseProps());

    expect(guest.fullName).toBe('Jane Guest');
    expect(guest.phone).toBe('+963912345678');
    expect(guest.email).toBeNull();
    expect(guest.anonymizedAt).toBeNull();
    expect(guest.createdAt).toEqual(now);
  });

  it('trims fullName', () => {
    const guest = ReservationGuest.create(baseProps({ fullName: '  Jane Guest  ' }));
    expect(guest.fullName).toBe('Jane Guest');
  });

  it('rejects an empty fullName', () => {
    expect(() => ReservationGuest.create(baseProps({ fullName: '   ' }))).toThrow(
      InvalidReservationException,
    );
  });

  it('rejects an invalid phone number for the given country (ADR-022 PhoneNumber VO)', () => {
    expect(() => ReservationGuest.create(baseProps({ phoneNumber: '123' }))).toThrow(
      InvalidPhoneNumberException,
    );
  });

  it('preserves an optional email when supplied', () => {
    const guest = ReservationGuest.create(baseProps({ email: 'jane@example.com' }));
    expect(guest.email).toBe('jane@example.com');
  });

  it('reconstitute() restores a persisted row unchanged', () => {
    const guest = ReservationGuest.reconstitute({
      id: '11111111-1111-4111-8111-111111111111',
      fullName: 'Jane Guest',
      phone: '+963912345678',
      email: null,
      anonymizedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    expect(guest.guestId).toBe('11111111-1111-4111-8111-111111111111');
    expect(guest.phone).toBe('+963912345678');
  });
});
