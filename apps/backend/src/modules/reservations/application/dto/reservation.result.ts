import { ReservationSource, ReservationStatus } from '../../domain/enums/reservation.enums';

export interface ReservationResult {
  reservationId: string;
  userId: string | null;
  reservationGuestId: string | null;
  restaurantId: string;
  branchId: string;
  tableId: string;
  reservationDate: Date;
  reservationStartTime: Date;
  reservationEndTime: Date;
  guests: number;
  status: ReservationStatus;
  source: ReservationSource;
  notes: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  cancelledAt: Date | null;
  completedAt: Date | null;
  noShowAt: Date | null;
  /** The offer this booking was attributed to (ADR-047), or null. */
  offerId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
