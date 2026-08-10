import { DomainException } from '@shared/domain/base/domain-exception.base';

/** ADR-034 §4 - Restore is only meaningful for a currently soft-deleted Organization. */
export class OrganizationNotSoftDeletedException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor() {
    super('Organization is not currently deleted.', 409);
  }
}
