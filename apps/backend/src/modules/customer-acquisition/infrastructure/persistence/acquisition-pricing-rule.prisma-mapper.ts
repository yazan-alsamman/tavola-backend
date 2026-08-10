import { Prisma } from '@prisma/client';
import { AcquisitionPricingRule } from '../../domain/entities/acquisition-pricing-rule.entity';
import { PricingFeeType, PricingScopeType } from '../../domain/enums/customer-acquisition.enums';

type AcquisitionPricingRuleRow = {
  id: string;
  scopeType: string;
  scopeId: string | null;
  feeType: string;
  flatAmount: Prisma.Decimal | null;
  flatCurrency: string | null;
  percentageValue: Prisma.Decimal | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  label: string;
  createdBy: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export class AcquisitionPricingRulePrismaMapper {
  static toDomain(row: AcquisitionPricingRuleRow): AcquisitionPricingRule {
    return AcquisitionPricingRule.reconstitute({
      id: row.id,
      scopeType: row.scopeType as PricingScopeType,
      scopeId: row.scopeId,
      feeType: row.feeType as PricingFeeType,
      flatAmount: row.flatAmount ? row.flatAmount.toNumber() : null,
      flatCurrency: row.flatCurrency,
      percentageValue: row.percentageValue ? row.percentageValue.toNumber() : null,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      label: row.label,
      createdBy: row.createdBy,
      archivedAt: row.archivedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  static toPersistence(entity: AcquisitionPricingRule) {
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
}
