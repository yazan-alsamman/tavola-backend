import { DomainException } from '@shared/domain/base/domain-exception.base';

export class InvalidSubscriptionStatusTransitionException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor(message: string) {
    super(message, 409);
  }
}
