import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * ADR-033 §17: currency resolution fails closed - an explicit error, never a
 * silent guess or an automatic conversion - when no `AcquisitionPricingRule`
 * exists in the target Restaurant's operating currency at any scope
 * (Restaurant, Organization, or the seeded Platform default). A disclosed
 * operational consequence of this design (ADR-033 Consequences/Negative):
 * a new operating currency requires deliberately seeding a matching-currency
 * pricing rule before its restaurants can generate acquisitions.
 */
export class NoMatchingPricingRuleException extends DomainException {
  public readonly code = 'NO_MATCHING_PRICING_RULE';

  constructor(message = 'No active pricing rule exists in the restaurant’s operating currency.') {
    super(message, 422);
  }
}
