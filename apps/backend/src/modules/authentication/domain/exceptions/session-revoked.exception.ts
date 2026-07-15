import { DomainException } from '@shared/domain/base/domain-exception.base';
import { SessionRevokeReason } from '../enums/authentication.enums';

export class SessionRevokedException extends DomainException {
  public readonly code = 'AUTH_INVALID_REFRESH_TOKEN';

  constructor(reason?: SessionRevokeReason | string) {
    super(reason ? `Session has been revoked: ${reason}.` : 'Session has been revoked.', 401);
  }
}
