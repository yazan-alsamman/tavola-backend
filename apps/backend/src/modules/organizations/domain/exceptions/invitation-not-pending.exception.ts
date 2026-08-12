import { DomainException } from '@shared/domain/base/domain-exception.base';

/** Revoke target is no longer Pending (already accepted, already revoked, or lost a concurrent race). */
export class InvitationNotPendingException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor() {
    super('This invitation is no longer pending.', 409);
  }
}
