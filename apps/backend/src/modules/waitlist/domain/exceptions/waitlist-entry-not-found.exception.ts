import { DomainException } from '@shared/domain/base/domain-exception.base';

export class WaitlistEntryNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor() {
    super('Waitlist entry not found.', 404);
  }
}
