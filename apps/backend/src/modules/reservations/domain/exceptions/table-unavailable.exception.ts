import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * DOMAIN_MODEL.md Tables business rules: "Disabled tables cannot receive
 * reservations" / "Tables under cleaning cannot be reserved" - only
 * `TableStatus.Available` tables may be booked.
 */
export class TableUnavailableException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor() {
    super('This table is not currently available for reservations.', 409);
  }
}
