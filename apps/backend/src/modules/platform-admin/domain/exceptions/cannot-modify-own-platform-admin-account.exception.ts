import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * A PlatformAdmin revoking or demoting their own account is a self-lockout
 * risk with no legitimate use case (ADR-034 §10's bootstrap invariant - "at
 * least one PlatformAdmin account must remain operationally seeded" - is
 * only meaningful if no single actor can revoke themselves down to zero
 * active admins). Not part of ADR-034's literal text; a minimal, necessary
 * guard given §10 authorizes the capability at all.
 */
export class CannotModifyOwnPlatformAdminAccountException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor() {
    super('A Platform Admin cannot deactivate or demote their own account.', 409);
  }
}
