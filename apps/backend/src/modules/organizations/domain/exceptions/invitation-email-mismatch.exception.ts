import { DomainException } from '@shared/domain/base/domain-exception.base';

/** Section 7 - an authenticated User may never accept an invitation addressed to a different email. */
export class InvitationEmailMismatchException extends DomainException {
  public readonly code = 'FORBIDDEN';

  constructor() {
    super('This invitation was issued to a different email address.', 403);
  }
}
