import { DomainException } from '@shared/domain/base/domain-exception.base';

/** Section 8 - the invitation's Organization was deleted or suspended after issuance. */
export class InvitationOrganizationUnavailableException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor() {
    super('This invitation can no longer be accepted.', 409);
  }
}
