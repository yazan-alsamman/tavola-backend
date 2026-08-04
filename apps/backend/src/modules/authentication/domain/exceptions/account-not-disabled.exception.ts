import { DomainException } from '@shared/domain/base/domain-exception.base';

/** ADR-034 §8 - Enable Login is only valid from a `Suspended` (admin-disabled) status - see `User.enableLogin()`'s own doc comment for why this is not treated as an idempotent no-op across every status. */
export class AccountNotDisabledException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor() {
    super('Account login is not currently disabled.', 409);
  }
}
