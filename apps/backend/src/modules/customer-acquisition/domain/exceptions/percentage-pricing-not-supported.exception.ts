import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * ADR-033 §16: `feeType = Percentage` is structurally defined but
 * functionally disabled - no field anywhere in this schema expresses a
 * monetary reservation/order value (payments were fully removed), so there
 * is nothing for a percentage to compute against. Rejected until a separate,
 * explicit future architecture decision introduces a monetary base-value
 * source - not a placeholder, an explicitly-guarded deferral.
 */
export class PercentagePricingNotSupportedException extends DomainException {
  public readonly code = 'PERCENTAGE_PRICING_NOT_SUPPORTED';

  constructor(
    message = 'feeType "Percentage" is structurally defined but not yet supported - no monetary base value exists in this schema for it to compute against (ADR-033 §16).',
  ) {
    super(message, 400);
  }
}
