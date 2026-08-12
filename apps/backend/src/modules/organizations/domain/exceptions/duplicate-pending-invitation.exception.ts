import { DomainException } from '@shared/domain/base/domain-exception.base';

/** Concurrent-issue race lost the database's partial unique index (Section 11/12). */
export class DuplicatePendingInvitationException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor() {
    super('A pending invitation for this email already exists.', 409);
  }
}
