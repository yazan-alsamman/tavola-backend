import { Prisma } from '@prisma/client';
import { CustomerAcquisition } from '../../domain/entities/customer-acquisition.entity';
import {
  AcquisitionCreatedVia,
  AcquisitionStatus,
} from '../../domain/enums/customer-acquisition.enums';
import { ReservationSource } from '@modules/reservations/domain/enums/reservation.enums';

type CustomerAcquisitionRow = {
  id: string;
  restaurantId: string;
  userId: string | null;
  reservationGuestId: string | null;
  sourceReservationId: string | null;
  reservationSource: string | null;
  createdVia: string;
  status: string;
  feeAmount: Prisma.Decimal;
  feeCurrency: string;
  pricingRuleId: string;
  recordedAt: Date;
  reversedAt: Date | null;
  reversedBy: string | null;
  reversalReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export class CustomerAcquisitionPrismaMapper {
  static toDomain(row: CustomerAcquisitionRow): CustomerAcquisition {
    return CustomerAcquisition.reconstitute({
      id: row.id,
      restaurantId: row.restaurantId,
      userId: row.userId,
      reservationGuestId: row.reservationGuestId,
      sourceReservationId: row.sourceReservationId,
      reservationSource: row.reservationSource as ReservationSource | null,
      createdVia: row.createdVia as AcquisitionCreatedVia,
      status: row.status as AcquisitionStatus,
      feeAmount: row.feeAmount.toNumber(),
      feeCurrency: row.feeCurrency,
      pricingRuleId: row.pricingRuleId,
      recordedAt: row.recordedAt,
      reversedAt: row.reversedAt,
      reversedBy: row.reversedBy,
      reversalReason: row.reversalReason,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  static toPersistence(entity: CustomerAcquisition) {
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
}
