import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * DOMAIN_MODEL.md's Reservation modification/rescheduling rule: a reservation
 * may be rescheduled only up until the restaurant's configured
 * `cancellationWindow` before its (current) scheduled time. Unlike Cancel
 * (never blocked by the window, only flagged), Reschedule is rejected
 * outright once the window has closed - Phase 7.3 architecture decision.
 */
export class ReservationRescheduleWindowExpiredException extends DomainException {
  public readonly code = 'RESERVATION_RESCHEDULE_WINDOW_EXPIRED';

  constructor() {
    super(
      'This reservation can no longer be rescheduled - the cancellation window before its scheduled time has closed.',
      409,
    );
  }
}
