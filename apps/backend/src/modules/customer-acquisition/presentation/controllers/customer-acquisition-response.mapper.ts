import { CustomerAcquisitionResult } from '../../application/dto/customer-acquisition.result';
import { PricingRuleResult } from '../../application/dto/pricing-rule.result';
import { CustomerAcquisitionResponseDto } from '../dto/customer-acquisition.response.dto';
import { PricingRuleResponseDto } from '../dto/pricing-rule.response.dto';

export function toCustomerAcquisitionResponse(
  result: CustomerAcquisitionResult,
): CustomerAcquisitionResponseDto {
  return {
    id: result.id,
    restaurantId: result.restaurantId,
    userId: result.userId,
    reservationGuestId: result.reservationGuestId,
    sourceReservationId: result.sourceReservationId,
    reservationSource: result.reservationSource,
    createdVia: result.createdVia,
    status: result.status,
    feeAmount: result.feeAmount,
    feeCurrency: result.feeCurrency,
    pricingRuleId: result.pricingRuleId,
    recordedAt: result.recordedAt.toISOString(),
    reversedAt: result.reversedAt ? result.reversedAt.toISOString() : null,
    reversedBy: result.reversedBy,
    reversalReason: result.reversalReason,
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
  };
}

export function toPricingRuleResponse(result: PricingRuleResult): PricingRuleResponseDto {
  return {
    id: result.id,
    scopeType: result.scopeType,
    scopeId: result.scopeId,
    feeType: result.feeType,
    flatAmount: result.flatAmount,
    flatCurrency: result.flatCurrency,
    percentageValue: result.percentageValue,
    effectiveFrom: result.effectiveFrom.toISOString(),
    effectiveTo: result.effectiveTo ? result.effectiveTo.toISOString() : null,
    label: result.label,
    createdBy: result.createdBy,
    archivedAt: result.archivedAt ? result.archivedAt.toISOString() : null,
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
  };
}
