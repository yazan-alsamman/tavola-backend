import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * Phase 7.5 final promotion-slot-semantics decision (2026-07-24): raised
 * when no currently-Available Table with sufficient capacity is free for the
 * entry's derived `(reservationStartTime, reservationEndTime)` window - the
 * entry is left unchanged (still Waiting/Notified), never converted into a
 * "seat now" fallback.
 */
export class NoTableAvailableForPromotionException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor() {
    super('No table with sufficient capacity is currently available for this waitlist entry.', 409);
  }
}
