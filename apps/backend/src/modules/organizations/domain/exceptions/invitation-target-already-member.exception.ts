import { DomainException } from '@shared/domain/base/domain-exception.base';

/** Section 12 - the invited email already belongs to an Active member of the Organization. */
export class InvitationTargetAlreadyMemberException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor() {
    super('This email already belongs to an active member of the Organization.', 409);
  }
}
