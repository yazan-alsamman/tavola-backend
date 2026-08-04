import { ReservationResult } from '../../application/dto/reservation.result';
import { TableAvailabilityResult } from '../../application/dto/table-availability.result';
import { MyReservationItem } from '../../application/ports/my-reservations-reader.port';
import { ReservationResponseDto } from '../dto/reservation.response.dto';
import { TableAvailabilityResponseDto } from '../dto/table-availability.response.dto';
import { MyReservationItemResponseDto } from '../dto/my-reservation-item.response.dto';

export function toReservationResponse(result: ReservationResult): ReservationResponseDto {
  return {
    reservationId: result.reservationId,
    userId: result.userId,
    reservationGuestId: result.reservationGuestId,
    restaurantId: result.restaurantId,
    branchId: result.branchId,
    tableId: result.tableId,
    reservationDate: result.reservationDate.toISOString().slice(0, 10),
    reservationStartTime: result.reservationStartTime.toISOString(),
    reservationEndTime: result.reservationEndTime.toISOString(),
    guests: result.guests,
    status: result.status,
    source: result.source,
    notes: result.notes,
    approvedBy: result.approvedBy,
    approvedAt: result.approvedAt ? result.approvedAt.toISOString() : null,
    cancelledAt: result.cancelledAt ? result.cancelledAt.toISOString() : null,
    completedAt: result.completedAt ? result.completedAt.toISOString() : null,
    noShowAt: result.noShowAt ? result.noShowAt.toISOString() : null,
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
  };
}

export function toMyReservationItemResponse(item: MyReservationItem): MyReservationItemResponseDto {
  return {
    reservationId: item.reservationId,
    restaurantId: item.restaurantId,
    restaurantName: item.restaurantName,
    restaurantImage: item.restaurantImage,
    branchId: item.branchId,
    branchName: item.branchName,
    reservationDate: item.reservationDate.toISOString().slice(0, 10),
    reservationStartTime: item.reservationStartTime.toISOString(),
    reservationEndTime: item.reservationEndTime.toISOString(),
    partySize: item.partySize,
    status: item.status,
    reservationSource: item.reservationSource,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    specialRequest: item.specialRequest,
    table: item.table
      ? {
          tableId: item.table.tableId,
          tableNumber: item.table.tableNumber,
          capacity: item.table.capacity,
        }
      : null,
  };
}

export function toTableAvailabilityResponse(
  result: TableAvailabilityResult,
): TableAvailabilityResponseDto {
  return {
    tableId: result.tableId,
    tableNumber: result.tableNumber,
    capacity: result.capacity,
    shape: result.shape,
    isAvailable: result.isAvailable,
  };
}
