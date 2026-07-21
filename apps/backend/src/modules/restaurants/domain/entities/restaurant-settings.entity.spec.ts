import { RestaurantSettings } from './restaurant-settings.entity';
import { InvalidRestaurantSettingsException } from '../exceptions/invalid-restaurant-settings.exception';

describe('RestaurantSettings entity', () => {
  const baseProps = {
    id: '11111111-1111-4111-8111-111111111111',
    restaurantId: '22222222-2222-4222-8222-222222222222',
    reservationIntervalMinutes: 30,
    maxGuestsPerReservation: 20,
    cancellationWindowMinutes: 60,
    pendingReservationTimeoutMinutes: 15,
    defaultReservationDurationMinutes: 90,
    autoApproval: false,
    timezone: 'UTC',
    defaultCurrency: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  function createSettings(): RestaurantSettings {
    return RestaurantSettings.reconstitute({ ...baseProps });
  }

  describe('createDefault', () => {
    it('produces sensible, valid defaults', () => {
      const at = new Date('2026-01-01T00:00:00.000Z');
      const settings = RestaurantSettings.createDefault(baseProps.id, baseProps.restaurantId, at);

      expect(settings.reservationIntervalMinutes).toBe(30);
      expect(settings.maxGuestsPerReservation).toBe(20);
      expect(settings.cancellationWindowMinutes).toBe(60);
      expect(settings.pendingReservationTimeoutMinutes).toBe(15);
      expect(settings.defaultReservationDurationMinutes).toBe(90);
      expect(settings.autoApproval).toBe(false);
      expect(settings.timezone).toBe('UTC');
      expect(settings.defaultCurrency).toBeNull();
      expect(settings.restaurantId.value).toBe(baseProps.restaurantId);
    });
  });

  describe('create validation', () => {
    it.each([
      ['reservationIntervalMinutes too low', { reservationIntervalMinutes: 1 }],
      ['reservationIntervalMinutes too high', { reservationIntervalMinutes: 300 }],
      ['maxGuestsPerReservation too low', { maxGuestsPerReservation: 0 }],
      ['maxGuestsPerReservation too high', { maxGuestsPerReservation: 500 }],
      ['cancellationWindowMinutes negative', { cancellationWindowMinutes: -1 }],
      ['cancellationWindowMinutes too high', { cancellationWindowMinutes: 999999 }],
      ['pendingReservationTimeoutMinutes too low', { pendingReservationTimeoutMinutes: 0 }],
      ['pendingReservationTimeoutMinutes too high', { pendingReservationTimeoutMinutes: 9999 }],
      ['defaultReservationDurationMinutes too low', { defaultReservationDurationMinutes: 14 }],
      ['defaultReservationDurationMinutes too high', { defaultReservationDurationMinutes: 481 }],
      ['empty timezone', { timezone: '' }],
      ['lowercase defaultCurrency', { defaultCurrency: 'usd' }],
      ['too-short defaultCurrency', { defaultCurrency: 'US' }],
    ])('rejects %s', (_label, overrides) => {
      expect(() => RestaurantSettings.create({ ...baseProps, ...overrides })).toThrow(
        InvalidRestaurantSettingsException,
      );
    });

    it('accepts a valid defaultCurrency', () => {
      const settings = RestaurantSettings.create({ ...baseProps, defaultCurrency: 'USD' });
      expect(settings.defaultCurrency).toBe('USD');
    });
  });

  describe('updateSettings', () => {
    it('replaces every configurable field', () => {
      const settings = createSettings();
      const at = new Date('2026-02-01T00:00:00.000Z');

      const updated = settings.updateSettings(
        {
          reservationIntervalMinutes: 15,
          maxGuestsPerReservation: 10,
          cancellationWindowMinutes: 30,
          pendingReservationTimeoutMinutes: 10,
          defaultReservationDurationMinutes: 60,
          autoApproval: true,
          timezone: 'Europe/Istanbul',
          defaultCurrency: 'EUR',
        },
        at,
      );

      expect(updated.reservationIntervalMinutes).toBe(15);
      expect(updated.maxGuestsPerReservation).toBe(10);
      expect(updated.cancellationWindowMinutes).toBe(30);
      expect(updated.pendingReservationTimeoutMinutes).toBe(10);
      expect(updated.defaultReservationDurationMinutes).toBe(60);
      expect(updated.autoApproval).toBe(true);
      expect(updated.timezone).toBe('Europe/Istanbul');
      expect(updated.defaultCurrency).toBe('EUR');
      expect(updated.updatedAt).toEqual(at);
    });

    it('does not mutate the original instance (immutability)', () => {
      const settings = createSettings();

      settings.updateSettings(
        {
          reservationIntervalMinutes: 15,
          maxGuestsPerReservation: 10,
          cancellationWindowMinutes: 30,
          pendingReservationTimeoutMinutes: 10,
          defaultReservationDurationMinutes: 60,
          autoApproval: true,
          timezone: 'Europe/Istanbul',
          defaultCurrency: 'EUR',
        },
        new Date('2026-02-01T00:00:00.000Z'),
      );

      expect(settings.reservationIntervalMinutes).toBe(30);
      expect(settings.timezone).toBe('UTC');
    });

    it('never changes restaurantId', () => {
      const settings = createSettings();

      const updated = settings.updateSettings(
        {
          reservationIntervalMinutes: 15,
          maxGuestsPerReservation: 10,
          cancellationWindowMinutes: 30,
          pendingReservationTimeoutMinutes: 10,
          defaultReservationDurationMinutes: 60,
          autoApproval: true,
          timezone: 'Europe/Istanbul',
          defaultCurrency: 'EUR',
        },
        new Date('2026-02-01T00:00:00.000Z'),
      );

      expect(updated.restaurantId.value).toBe(settings.restaurantId.value);
    });

    it('rejects an invalid update the same way create() does', () => {
      const settings = createSettings();

      expect(() =>
        settings.updateSettings(
          {
            reservationIntervalMinutes: 1,
            maxGuestsPerReservation: 10,
            cancellationWindowMinutes: 30,
            pendingReservationTimeoutMinutes: 10,
            defaultReservationDurationMinutes: 60,
            autoApproval: true,
            timezone: 'UTC',
            defaultCurrency: null,
          },
          new Date('2026-02-01T00:00:00.000Z'),
        ),
      ).toThrow(InvalidRestaurantSettingsException);
    });

    it('allows clearing defaultCurrency back to null', () => {
      const settings = RestaurantSettings.reconstitute({ ...baseProps, defaultCurrency: 'USD' });

      const updated = settings.updateSettings(
        {
          reservationIntervalMinutes: 30,
          maxGuestsPerReservation: 20,
          cancellationWindowMinutes: 60,
          pendingReservationTimeoutMinutes: 15,
          defaultReservationDurationMinutes: 90,
          autoApproval: false,
          timezone: 'UTC',
          defaultCurrency: null,
        },
        new Date('2026-02-01T00:00:00.000Z'),
      );

      expect(updated.defaultCurrency).toBeNull();
    });
  });
});
