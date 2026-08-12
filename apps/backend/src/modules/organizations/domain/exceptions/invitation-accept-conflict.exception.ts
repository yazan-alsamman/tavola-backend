import { DomainException } from '@shared/domain/base/domain-exception.base';

/** Concurrent acceptance / concurrent revoke race lost the CAS - the token is no longer live by the time this request's write ran. */
export class InvitationAcceptConflictException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor() {
    super('This invitation was already used or is no longer active.', 409);
  }
}
