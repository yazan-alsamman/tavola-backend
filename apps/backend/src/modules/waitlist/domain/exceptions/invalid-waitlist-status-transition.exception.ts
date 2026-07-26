import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * Phase 7.5 architecture freeze item 6 (frozen state machine): raised
 * whenever a `ReservationWaitlistEntry` transition is attempted outside
 * `Waiting -> {Notified, Converted, Cancelled, Expired}`,
 * `Notified -> {Converted, Cancelled, Expired}` - including a claim/promotion
 * attempt losing a concurrent race (the database-level conditional update
 * finding the row already moved away from the expected status).
 */
export class InvalidWaitlistStatusTransitionException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor(message: string) {
    super(message, 400);
  }
}
