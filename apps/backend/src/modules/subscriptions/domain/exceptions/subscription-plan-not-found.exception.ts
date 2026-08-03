import { DomainException } from '@shared/domain/base/domain-exception.base';

export class SubscriptionPlanNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor() {
    super('Subscription plan not found.', 404);
  }
}
