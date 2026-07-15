import { DomainException } from '@shared/domain/base/domain-exception.base';

export class ExpiredVerificationTokenException extends DomainException {
  public readonly code = 'AUTH_EXPIRED_TOKEN';

  constructor() {
    super('Verification token has expired.', 401);
  }
}
