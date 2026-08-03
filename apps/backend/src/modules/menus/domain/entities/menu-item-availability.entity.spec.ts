import { MenuItemAvailability } from './menu-item-availability.entity';
import { InvalidMenuItemAvailabilityException } from '../exceptions/invalid-menu-item-availability.exception';

describe('MenuItemAvailability entity', () => {
  const fixedNow = new Date('2026-08-03T10:00:00.000Z');
  const menuItemId = '55555555-5555-4555-8555-555555555555';
  const restaurantId = '33333333-3333-4333-8333-333333333333';

  function makeWindow(overrides?: { dayOfWeek?: number; startTime?: string; endTime?: string }) {
    return MenuItemAvailability.create({
      id: '77777777-7777-4777-8777-777777777777',
      menuItemId,
      restaurantId,
      dayOfWeek: overrides?.dayOfWeek ?? 1,
      startTime: overrides?.startTime ?? '08:00',
      endTime: overrides?.endTime ?? '11:00',
      now: fixedNow,
    });
  }

  it('creates a valid window', () => {
    const window = makeWindow();
    expect(window.dayOfWeek).toBe(1);
    expect(window.startTime).toBe('08:00');
    expect(window.endTime).toBe('11:00');
  });

  it('rejects a dayOfWeek outside 0-6', () => {
    expect(() => makeWindow({ dayOfWeek: 7 })).toThrow(InvalidMenuItemAvailabilityException);
    expect(() => makeWindow({ dayOfWeek: -1 })).toThrow(InvalidMenuItemAvailabilityException);
  });

  it('rejects a malformed startTime', () => {
    expect(() => makeWindow({ startTime: '8:00' })).toThrow(InvalidMenuItemAvailabilityException);
    expect(() => makeWindow({ startTime: '25:00' })).toThrow(InvalidMenuItemAvailabilityException);
  });

  it('rejects endTime not strictly after startTime', () => {
    expect(() => makeWindow({ startTime: '11:00', endTime: '11:00' })).toThrow(
      InvalidMenuItemAvailabilityException,
    );
    expect(() => makeWindow({ startTime: '12:00', endTime: '11:00' })).toThrow(
      InvalidMenuItemAvailabilityException,
    );
  });
});
