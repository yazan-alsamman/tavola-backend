import { AcquisitionPricingRule } from '../../domain/entities/acquisition-pricing-rule.entity';
import { PricingRuleResult } from '../dto/pricing-rule.result';

export function toPricingRuleResult(entity: AcquisitionPricingRule): PricingRuleResult {
  const props = entity.toProps();
  return {
    id: props.id,
    scopeType: props.scopeType,
    scopeId: props.scopeId,
    feeType: props.feeType,
    flatAmount: props.flatAmount,
    flatCurrency: props.flatCurrency,
    percentageValue: props.percentageValue,
    effectiveFrom: props.effectiveFrom,
    effectiveTo: props.effectiveTo,
    label: props.label,
    createdBy: props.createdBy,
    archivedAt: props.archivedAt,
    createdAt: props.createdAt,
    updatedAt: props.updatedAt,
  };
}
