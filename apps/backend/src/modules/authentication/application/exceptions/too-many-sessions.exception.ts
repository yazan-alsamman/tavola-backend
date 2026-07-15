import { DomainException } from '@shared/domain/base/domain-exception.base';

export class TooManySessionsException extends DomainException {
  public readonly code = 'AUTH_TOO_MANY_SESSIONS';

  constructor(maxSessions: number) {
    super(`Maximum active sessions (${maxSessions}) exceeded.`, 409);
  }
}
