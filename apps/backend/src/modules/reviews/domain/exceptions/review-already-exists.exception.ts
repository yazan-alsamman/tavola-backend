import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * Thrown both on the pre-check (application-level, friendly error) and when
 * the database's own `UNIQUE(reservationId)` constraint rejects a losing
 * concurrent insert (P2002, mapped by the Prisma repository) - owner
 * decision: enforce at both layers, never rely on the pre-check alone.
 */
export class ReviewAlreadyExistsException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor() {
    super('A review already exists for this reservation.', 409);
  }
}
