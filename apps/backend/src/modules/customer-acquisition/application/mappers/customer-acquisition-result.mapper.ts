import { CustomerAcquisition } from '../../domain/entities/customer-acquisition.entity';
import { CustomerAcquisitionResult } from '../dto/customer-acquisition.result';

export function toCustomerAcquisitionResult(
  entity: CustomerAcquisition,
): CustomerAcquisitionResult {
  const props = entity.toProps();
  return {
    id: props.id,
    restaurantId: props.restaurantId,
    userId: props.userId,
    reservationGuestId: props.reservationGuestId,
    sourceReservationId: props.sourceReservationId,
    reservationSource: props.reservationSource,
    createdVia: props.createdVia,
    status: props.status,
    feeAmount: props.feeAmount,
    feeCurrency: props.feeCurrency,
    pricingRuleId: props.pricingRuleId,
    recordedAt: props.recordedAt,
    reversedAt: props.reversedAt,
    reversedBy: props.reversedBy,
    reversalReason: props.reversalReason,
    createdAt: props.createdAt,
    updatedAt: props.updatedAt,
  };
}
