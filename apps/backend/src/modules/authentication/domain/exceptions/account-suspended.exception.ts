import { DomainException } from '@shared/domain/base/domain-exception.base';

export class AccountSuspendedException extends DomainException {
  public readonly code = 'AUTH_ACCOUNT_SUSPENDED';

  constructor() {
    super('Account is suspended.', 403);
  }
}
