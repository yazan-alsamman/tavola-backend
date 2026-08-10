import {
  AcquisitionCreatedVia,
  AcquisitionStatus,
} from '../../domain/enums/customer-acquisition.enums';

export interface CustomerAcquisitionResult {
  id: string;
  restaurantId: string;
  userId: string | null;
  reservationGuestId: string | null;
  sourceReservationId: string | null;
  reservationSource: string | null;
  createdVia: AcquisitionCreatedVia;
  status: AcquisitionStatus;
  feeAmount: number;
  feeCurrency: string;
  pricingRuleId: string;
  recordedAt: Date;
  reversedAt: Date | null;
  reversedBy: string | null;
  reversalReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}
