import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * Defense-in-depth only - the branch+preferredDate advisory lock (Phase 7.5
 * §9) should make this unreachable in practice; the partial unique
 * `reservation_waitlist_entries_active_position_key` index is the database-
 * level safety net (ADR-013's own belt-and-suspenders shape, reused).
 */
export class WaitlistPositionConflictException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor() {
    super('A concurrent Join already claimed this queue position - please retry.', 409);
  }
}
