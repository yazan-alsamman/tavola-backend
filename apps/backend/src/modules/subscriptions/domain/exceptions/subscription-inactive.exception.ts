import { DomainException } from '@shared/domain/base/domain-exception.base';

/** ADR-027 §20 - `SUBSCRIPTION_INACTIVE`, 403. */
export class SubscriptionInactiveException extends DomainException {
  public readonly code = 'SUBSCRIPTION_INACTIVE';

  constructor() {
    super('Organization subscription is not active.', 403);
  }
}
