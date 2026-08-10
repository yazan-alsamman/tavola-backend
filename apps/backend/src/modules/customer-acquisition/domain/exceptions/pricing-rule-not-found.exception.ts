import { DomainException } from '@shared/domain/base/domain-exception.base';

export class PricingRuleNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor(message = 'Acquisition pricing rule not found.') {
    super(message, 404);
  }
}
