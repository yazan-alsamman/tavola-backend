import { DomainException } from '@shared/domain/base/domain-exception.base';

export class ExpiredResetTokenException extends DomainException {
  public readonly code = 'AUTH_EXPIRED_TOKEN';

  constructor() {
    super('Reset token has expired.', 401);
  }
}
