import { DomainException } from '@shared/domain/base/domain-exception.base';

export class AccountLockedException extends DomainException {
  public readonly code = 'AUTH_ACCOUNT_LOCKED';

  constructor(lockedUntil: Date) {
    super(`Account is temporarily locked until ${lockedUntil.toISOString()}.`, 403);
  }
}
