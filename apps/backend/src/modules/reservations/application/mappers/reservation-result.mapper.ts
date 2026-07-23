import { Reservation } from '../../domain/entities/reservation.entity';
import { ReservationResult } from '../dto/reservation.result';

export function toReservationResult(reservation: Reservation): ReservationResult {
  return {
    reservationId: reservation.reservationId.value,
    userId: reservation.userId?.value ?? null,
    restaurantId: reservation.restaurantId.value,
    branchId: reservation.branchId.value,
    tableId: reservation.tableId.value,
    reservationDate: reservation.reservationDate,
    reservationStartTime: reservation.reservationStartTime,
    reservationEndTime: reservation.reservationEndTime,
    guests: reservation.guests,
    status: reservation.status,
    source: reservation.source,
    notes: reservation.notes,
    approvedBy: reservation.approvedBy,
    approvedAt: reservation.approvedAt,
    cancelledAt: reservation.cancelledAt,
    completedAt: reservation.completedAt,
    noShowAt: reservation.noShowAt,
    createdAt: reservation.createdAt,
    updatedAt: reservation.updatedAt,
  };
}
