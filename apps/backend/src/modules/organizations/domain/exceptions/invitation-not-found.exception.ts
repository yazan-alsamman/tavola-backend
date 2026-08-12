import { DomainException } from '@shared/domain/base/domain-exception.base';

export class InvitationNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor() {
    super('Invitation not found.', 404);
  }
}
