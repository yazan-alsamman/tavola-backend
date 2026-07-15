import { DomainException } from '@shared/domain/base/domain-exception.base';

export class OwnershipTransferRequiredException extends DomainException {
  public readonly code = 'FORBIDDEN';

  constructor() {
    super('Ownership must be transferred before changing the owner role.', 403);
  }
}
