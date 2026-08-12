import { DomainException } from '@shared/domain/base/domain-exception.base';

/** Section 13 - Owner invariant. Use Transfer Ownership instead. */
export class InvitationCannotGrantOwnerRoleException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor() {
    super('An invitation cannot grant the Owner role - use Transfer Ownership instead.', 400);
  }
}
