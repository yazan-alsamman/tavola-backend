import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * Phase 7.5 final promotion-slot-semantics decision (2026-07-24):
 * `preferredDate` + `preferredTimeFrom` (interpreted in Branch.timezone)
 * must derive a Reservation start time strictly in the future - the same
 * `Reservation.validate()` invariant, checked at Join time so a request that
 * could never be promoted is rejected immediately rather than silently
 * queued.
 */
export class WaitlistPreferredTimeInPastException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor() {
    super('preferredDate/preferredTimeFrom must resolve to a time in the future.', 400);
  }
}
