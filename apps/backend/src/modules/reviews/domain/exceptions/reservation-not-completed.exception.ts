import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * Owner decision #3: a Review may only be submitted for a `Completed`
 * reservation. Only reachable once the reservation is confirmed to exist and
 * be owned by the caller (`ReservationNotFoundException`/404 already
 * collapses the not-found/not-owned/guest-only cases before this point) -
 * this is the one remaining, non-IDOR-sensitive validation failure, hence
 * 400 rather than 404.
 */
export class ReservationNotCompletedException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor() {
    super('A review may only be submitted for a completed reservation.', 400);
  }
}
