import { PricingFeeType, PricingScopeType } from '../../domain/enums/customer-acquisition.enums';

export interface PricingRuleResult {
  id: string;
  scopeType: PricingScopeType;
  scopeId: string | null;
  feeType: PricingFeeType;
  flatAmount: number | null;
  flatCurrency: string | null;
  percentageValue: number | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  label: string;
  createdBy: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
