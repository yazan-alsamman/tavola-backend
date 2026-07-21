import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * ADR-013: raised when the advisory-locked re-check or the database
 * exclusion constraint (a caught Postgres exclusion-violation error) finds an
 * overlapping confirmed (`Approved`/`Completed`/`NoShow`) reservation for the
 * same table. Not reachable via any Phase 7.1 code path today - Phase 7.1
 * only ever produces `Pending` rows, which the exclusion constraint
 * deliberately does not guard (two overlapping Pending reservations may
 * coexist) - but the mapping exists now so the mechanism is already correct
 * once Phase 7.2 (Approval) makes `Approved` reachable.
 */
export class ReservationConflictException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor() {
    super('This table is no longer available for the requested time.', 409);
  }
}
