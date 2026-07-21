import { ReservationSource, ReservationStatus } from '../../domain/enums/reservation.enums';

export interface ReservationResult {
  reservationId: string;
  userId: string | null;
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
  createdAt: Date;
  updatedAt: Date;
}
