import { DomainException } from '@shared/domain/base/domain-exception.base';

export class UsernameAlreadyExistsException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor() {
    super('Username is already taken.', 409);
  }
}
