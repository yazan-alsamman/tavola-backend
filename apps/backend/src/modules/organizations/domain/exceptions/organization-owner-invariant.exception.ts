import { DomainException } from '@shared/domain/base/domain-exception.base';

export class OrganizationOwnerInvariantException extends DomainException {
  public readonly code = 'FORBIDDEN';

  constructor() {
    super('Organization must have exactly one active owner.', 403);
  }
}
