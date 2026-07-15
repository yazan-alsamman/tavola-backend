import { DomainException } from '@shared/domain/base/domain-exception.base';

export class MissingAccessTokenException extends DomainException {
  public readonly code = 'AUTH_INVALID_TOKEN';

  constructor() {
    super('Access token is required.', 401);
  }
}

export class InvalidAccessTokenException extends DomainException {
  public readonly code = 'AUTH_INVALID_TOKEN';

  constructor() {
    super('Invalid access token.', 401);
  }
}

export class ExpiredAccessTokenException extends DomainException {
  public readonly code = 'AUTH_EXPIRED_TOKEN';

  constructor() {
    super('Access token has expired.', 401);
  }
}

export class StaleSessionVersionException extends DomainException {
  public readonly code = 'AUTH_INVALID_TOKEN';

  constructor() {
    super('Session is no longer valid.', 401);
  }
}
