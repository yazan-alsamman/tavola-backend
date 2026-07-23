import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * TASKS.md "Phase 7 — Reservation Engine: Pre-implementation architecture
 * decisions" item 1: the same convention as `InvalidTableStatusTransitionException`.
 * Raised whenever a Reservation transition is attempted outside the frozen
 * state machine (`Pending -> {Approved, Rejected, Expired, Cancelled}`,
 * `Approved -> {Completed, Cancelled, NoShow}`) - including approving/
 * rejecting a reservation that is no longer `Pending`, whether caught from
 * the in-memory entity snapshot or from the database-level conditional
 * update losing a concurrent race (ADR-013's optimistic-locking technique).
 */
export class InvalidReservationStatusTransitionException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor(message: string) {
    super(message, 400);
  }
}
