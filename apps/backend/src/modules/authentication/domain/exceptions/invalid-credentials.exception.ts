import { DomainException } from '@shared/domain/base/domain-exception.base';

export class InvalidCredentialsException extends DomainException {
  public readonly code = 'AUTH_INVALID_CREDENTIALS';

  constructor() {
    super('Invalid email or password.', 401);
  }
}
