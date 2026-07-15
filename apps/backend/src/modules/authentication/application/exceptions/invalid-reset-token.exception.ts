import { DomainException } from '@shared/domain/base/domain-exception.base';

export class InvalidResetTokenException extends DomainException {
  public readonly code = 'AUTH_INVALID_TOKEN';

  constructor() {
    super('Invalid reset token.', 401);
  }
}
