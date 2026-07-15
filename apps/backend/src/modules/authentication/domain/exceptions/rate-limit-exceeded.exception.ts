import { DomainException } from '@shared/domain/base/domain-exception.base';

export class RateLimitExceededException extends DomainException {
  public readonly code = 'RATE_LIMIT_EXCEEDED';

  constructor() {
    super('Too many requests. Please try again later.', 429);
  }
}
