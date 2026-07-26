import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * Phase 6 (Merge/Split Tables, ADR-026 decision #6/#9). Thrown when Merge or
 * Split cannot proceed because the current, freshly-re-read-inside-the-
 * topology-lock state conflicts with the request: a component table is no
 * longer `Available`/eligible, is already part of a different merge group,
 * or - the reservation-blocking rule - a component (Merge) or the primary
 * (Split) still has a `Pending`/`Approved` reservation whose
 * `reservationEndTime` has not yet passed. A conflict, not a validation
 * failure - the request was well-formed, but the current server state
 * disagrees with it (matches `ReservationConflictException`'s own 409
 * precedent for the same category of "request was fine, state moved" error).
 */
export class TableMergeConflictException extends DomainException {
  public readonly code = 'TABLE_MERGE_CONFLICT';

  constructor(message: string) {
    super(message, 409);
  }
}
