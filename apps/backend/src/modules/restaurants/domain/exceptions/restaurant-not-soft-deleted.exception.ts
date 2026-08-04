import { DomainException } from '@shared/domain/base/domain-exception.base';

/** ADR-034 §3 - Restore is only meaningful for a currently soft-deleted Restaurant. */
export class RestaurantNotSoftDeletedException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor() {
    super('Restaurant is not currently deleted.', 409);
  }
}
