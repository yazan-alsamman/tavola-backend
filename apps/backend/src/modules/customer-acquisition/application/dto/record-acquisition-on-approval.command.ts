import { ReservationSource } from '@modules/reservations/domain/enums/reservation.enums';

export interface RecordAcquisitionOnApprovalCommand {
  restaurantId: string;
  branchId: string;
  userId: string | null;
  reservationGuestId: string | null;
  source: ReservationSource;
  sourceReservationId: string;
  now: Date;
  correlationId?: string;
}

export interface RecordAcquisitionOnApprovalResult {
  recorded: boolean;
  acquisitionId?: string;
  feeAmount?: number;
  feeCurrency?: string;
  pricingRuleId?: string;
  customerIdentityKey?: string;
}
