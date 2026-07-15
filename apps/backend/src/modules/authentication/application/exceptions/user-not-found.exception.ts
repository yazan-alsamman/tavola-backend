import { DomainException } from '@shared/domain/base/domain-exception.base';

export class UserNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor() {
    super('User not found.', 404);
  }
}
