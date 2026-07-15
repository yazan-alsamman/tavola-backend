import { DomainException } from '@shared/domain/base/domain-exception.base';

export class InvalidRefreshTokenException extends DomainException {
  public readonly code = 'AUTH_INVALID_REFRESH_TOKEN';

  constructor() {
    super('Invalid refresh token.', 401);
  }
}
