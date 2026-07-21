import { DomainException } from '@shared/domain/base/domain-exception.base';

export class CannotRemoveLastManagerException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor() {
    super('Cannot remove the last Manager-role employee of a restaurant.', 409);
  }
}
