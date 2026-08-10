import { PricingFeeType, PricingScopeType } from '../../domain/enums/customer-acquisition.enums';

export interface ActivatePricingRuleCommand {
  scopeType: PricingScopeType;
  scopeId: string | null;
  feeType: PricingFeeType;
  flatAmount: number | null;
  flatCurrency: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  label: string;
  /** Optional - archives the named superseded rule in the same operation (ADR-033 §15). */
  supersedesRuleId?: string;
  actorId: string;
  correlationId?: string;
}
