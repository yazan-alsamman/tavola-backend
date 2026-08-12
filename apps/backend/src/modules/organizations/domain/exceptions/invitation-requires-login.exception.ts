import { DomainException } from '@shared/domain/base/domain-exception.base';

/** Section 7 - the invited email already has an account; the invitee must authenticate before acceptance can create the membership. */
export class InvitationRequiresLoginException extends DomainException {
  public readonly code = 'UNAUTHORIZED';

  constructor() {
    super('An account already exists for this email - log in and try again.', 401);
  }
}
