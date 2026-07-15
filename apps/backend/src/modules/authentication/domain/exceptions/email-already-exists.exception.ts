import { DomainException } from '@shared/domain/base/domain-exception.base';

export class EmailAlreadyExistsException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor(email: string) {
    super(`An account with email ${email} already exists.`, 409);
  }
}
