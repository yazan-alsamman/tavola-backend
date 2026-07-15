import { DomainException } from '@shared/domain/base/domain-exception.base';

export class PasswordReusedException extends DomainException {
  public readonly code = 'AUTH_PASSWORD_REUSED';

  constructor() {
    super('Password was used recently and cannot be reused.', 400);
  }
}
