import { DomainException } from '@shared/domain/base/domain-exception.base';

export class SoleOwnerRemovalException extends DomainException {
  public readonly code = 'FORBIDDEN';

  constructor() {
    super('Cannot remove the sole organization owner.', 403);
  }
}
