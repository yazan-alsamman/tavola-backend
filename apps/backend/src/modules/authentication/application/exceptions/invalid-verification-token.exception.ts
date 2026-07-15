import { DomainException } from '@shared/domain/base/domain-exception.base';

export class InvalidVerificationTokenException extends DomainException {
  public readonly code = 'AUTH_INVALID_TOKEN';

  constructor() {
    super('Invalid verification token.', 401);
  }
}
