import { DomainException } from '@shared/domain/base/domain-exception.base';

export class SessionAccessDeniedException extends DomainException {
  public readonly code = 'AUTH_SESSION_NOT_FOUND';

  constructor() {
    super('Session not found.', 404);
  }
}
