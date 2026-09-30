import {
  buildReservationTimeSlots,
  dayOfWeekFromCalendarDate,
  zonedLocalToUtcIso,
} from './reservation-time-slots.service';

describe('reservation time slots', () => {
  it('steps from opening by the interval and keeps only windows that fit the duration', () => {
    const slots = buildReservationTimeSlots(
      '2026-09-30',
      {
        openingTime: '18:00',
        closingTime: '23:00',
        breakStartTime: null,
        breakEndTime: null,
      },
      30,
      120,
    );

    expect(slots.map((slot) => slot.startTime)).toEqual([
      '18:00',
      '18:30',
      '19:00',
      '19:30',
      '20:00',
      '20:30',
      '21:00',
    ]);
    expect(slots[0]).toMatchObject({ endTime: '20:00', endDate: '2026-09-30' });
  });

  it('drops a window that would overlap the break', () => {
    const slots = buildReservationTimeSlots(
      '2026-09-28',
      {
        openingTime: '12:00',
        closingTime: '17:00',
        breakStartTime: '14:00',
        breakEndTime: '15:00',
      },
      30,
      90,
    );

    expect(slots.map((slot) => `${slot.startTime}-${slot.endTime}`)).toEqual([
      '12:00-13:30',
      '12:30-14:00',
      '15:00-16:30',
      '15:30-17:00',
    ]);
  });

  it('lets a duration cross midnight when closing is on the next day', () => {
    const slots = buildReservationTimeSlots(
      '2026-09-28',
      {
        openingTime: '22:00',
        closingTime: '02:00',
        breakStartTime: null,
        breakEndTime: null,
      },
      60,
      120,
    );

    expect(slots).toEqual([
      { startTime: '22:00', date: '2026-09-28', endTime: '00:00', endDate: '2026-09-29' },
      { startTime: '23:00', date: '2026-09-28', endTime: '01:00', endDate: '2026-09-29' },
      { startTime: '00:00', date: '2026-09-29', endTime: '02:00', endDate: '2026-09-29' },
    ]);
  });

  it('returns no slots when the day is closed or the duration cannot fit', () => {
    expect(buildReservationTimeSlots('2026-09-28', null, 30, 90)).toEqual([]);
    expect(
      buildReservationTimeSlots(
        '2026-09-28',
        {
          openingTime: '18:00',
          closingTime: '19:00',
          breakStartTime: null,
          breakEndTime: null,
        },
        30,
        120,
      ),
    ).toEqual([]);
  });

  it('reads Monday 28 September 2026 as dayOfWeek 1', () => {
    expect(dayOfWeekFromCalendarDate('2026-09-28')).toBe(1);
  });

  it('converts a Damascus wall time to UTC', () => {
    expect(zonedLocalToUtcIso('2026-09-28', '12:00', 'Asia/Damascus')).toBe(
      '2026-09-28T09:00:00.000Z',
    );
  });
});
