import { WorkingHours } from './working-hours.entity';
import { InvalidWorkingHoursException } from '../exceptions/invalid-working-hours.exception';

describe('WorkingHours entity', () => {
  const baseProps = {
    id: '11111111-1111-4111-8111-111111111111',
    restaurantId: '22222222-2222-4222-8222-222222222222',
    dayOfWeek: 1,
    openingTime: '09:00',
    closingTime: '22:00',
    breakStartTime: null as string | null,
    breakEndTime: null as string | null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  describe('create validation', () => {
    it('accepts a valid restaurant-level day with no break', () => {
      const workingHours = WorkingHours.create({ ...baseProps });

      expect(workingHours.dayOfWeek).toBe(1);
      expect(workingHours.openingTime).toBe('09:00');
      expect(workingHours.closingTime).toBe('22:00');
      expect(workingHours.breakStartTime).toBeNull();
      expect(workingHours.breakEndTime).toBeNull();
      expect(workingHours.restaurantId.value).toBe(baseProps.restaurantId);
    });

    it('accepts a valid break period within the day', () => {
      const workingHours = WorkingHours.create({
        ...baseProps,
        breakStartTime: '15:00',
        breakEndTime: '16:30',
      });

      expect(workingHours.breakStartTime).toBe('15:00');
      expect(workingHours.breakEndTime).toBe('16:30');
    });

    it('allows closingTime earlier than or equal to openingTime (crosses midnight)', () => {
      const workingHours = WorkingHours.create({
        ...baseProps,
        openingTime: '18:00',
        closingTime: '02:00',
      });

      expect(workingHours.openingTime).toBe('18:00');
      expect(workingHours.closingTime).toBe('02:00');
    });

    it.each([
      ['dayOfWeek negative', { dayOfWeek: -1 }],
      ['dayOfWeek too high', { dayOfWeek: 7 }],
      ['dayOfWeek non-integer', { dayOfWeek: 2.5 }],
      ['openingTime malformed', { openingTime: '9am' }],
      ['openingTime out of range hour', { openingTime: '24:00' }],
      ['closingTime malformed', { closingTime: 'not-a-time' }],
      ['breakStartTime without breakEndTime', { breakStartTime: '15:00', breakEndTime: null }],
      ['breakEndTime without breakStartTime', { breakStartTime: null, breakEndTime: '16:00' }],
      ['breakStartTime after breakEndTime', { breakStartTime: '17:00', breakEndTime: '16:00' }],
      ['breakStartTime equal to breakEndTime', { breakStartTime: '16:00', breakEndTime: '16:00' }],
      ['breakStartTime malformed', { breakStartTime: '99:99', breakEndTime: '16:00' }],
    ])('rejects %s', (_label, overrides) => {
      expect(() => WorkingHours.create({ ...baseProps, ...overrides })).toThrow(
        InvalidWorkingHoursException,
      );
    });
  });

  describe('reconstitute', () => {
    it('bypasses validation for trusted persistence round-trips', () => {
      const workingHours = WorkingHours.reconstitute({ ...baseProps, dayOfWeek: 1 });
      expect(workingHours.dayOfWeek).toBe(1);
    });
  });

  describe('toProps', () => {
    it('returns a snapshot of every field', () => {
      const workingHours = WorkingHours.create({ ...baseProps });
      expect(workingHours.toProps()).toEqual(baseProps);
    });
  });
});
