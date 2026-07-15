import { DomainException } from '@shared/domain/base/domain-exception.base';

export class TokenFamilyCompromisedException extends DomainException {
  public readonly code = 'AUTH_INVALID_REFRESH_TOKEN';

  constructor() {
    super('Token family has been compromised.', 401);
  }
}
