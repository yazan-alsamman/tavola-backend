import { DomainException } from '@shared/domain/base/domain-exception.base';

export class MaxActiveSessionsExceededException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor(maxSessions: number) {
    super(`Maximum active sessions (${maxSessions}) exceeded.`, 409);
  }
}
