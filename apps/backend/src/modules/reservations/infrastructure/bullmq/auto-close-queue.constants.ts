/**
 * CR WJ-R-2026-002 round 2 - the recurring sweep that closes overdue
 * Approved reservations (`AutoCloseOverdueReservationsUseCase`). One job
 * scheduler, upserted at boot, so restarts and multiple API instances never
 * stack duplicate schedules.
 */
export const AUTO_CLOSE_QUEUE_NAME = 'ReservationAutoCloseQueue';

export const AUTO_CLOSE_JOB_NAME = 'reservation-auto-close-sweep';

export const AUTO_CLOSE_SCHEDULER_ID = 'reservation-auto-close';

/** How often the sweep runs. */
export const AUTO_CLOSE_EVERY_MS = 5 * 60_000;
