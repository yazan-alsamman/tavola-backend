import { CancellationWindowService } from './cancellation-window.service';

describe('CancellationWindowService', () => {
  const reservationStartTime = new Date('2026-08-01T18:00:00.000Z');

  it('is not within the window well before the reservation time', () => {
    const now = new Date('2026-08-01T10:00:00.000Z');
    expect(CancellationWindowService.isWithinWindow(reservationStartTime, 60, now)).toBe(false);
  });

  it('is within the window exactly at the window boundary', () => {
    const now = new Date('2026-08-01T17:00:00.000Z');
    expect(CancellationWindowService.isWithinWindow(reservationStartTime, 60, now)).toBe(true);
  });

  it('is within the window one minute before the boundary closes', () => {
    const now = new Date('2026-08-01T17:01:00.000Z');
    expect(CancellationWindowService.isWithinWindow(reservationStartTime, 60, now)).toBe(true);
  });

  it('is not within the window one minute before the boundary opens', () => {
    const now = new Date('2026-08-01T16:59:00.000Z');
    expect(CancellationWindowService.isWithinWindow(reservationStartTime, 60, now)).toBe(false);
  });

  it('is within the window after the reservation time has already passed', () => {
    const now = new Date('2026-08-01T19:00:00.000Z');
    expect(CancellationWindowService.isWithinWindow(reservationStartTime, 60, now)).toBe(true);
  });
});
