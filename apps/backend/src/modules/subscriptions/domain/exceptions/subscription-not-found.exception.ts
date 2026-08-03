import { DomainException } from '@shared/domain/base/domain-exception.base';

export class SubscriptionNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor() {
    super('Subscription not found.', 404);
  }
}
