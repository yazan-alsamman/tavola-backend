import { Reservation as PrismaReservationRow } from '@prisma/client';
import { Reservation, ReservationProps } from '../../domain/entities/reservation.entity';
import { ReservationSource, ReservationStatus } from '../../domain/enums/reservation.enums';

export type ReservationRow = PrismaReservationRow;

export class ReservationPrismaMapper {
  static toDomain(row: ReservationRow): Reservation {
    if (!Object.values(ReservationStatus).includes(row.status as ReservationStatus)) {
      throw new Error(`Unknown reservation status persisted: ${row.status}`);
    }
    if (!Object.values(ReservationSource).includes(row.source as ReservationSource)) {
      throw new Error(`Unknown reservation source persisted: ${row.source}`);
    }

    const props: ReservationProps = {
      id: row.id,
      userId: row.userId,
      reservationGuestId: row.reservationGuestId,
      restaurantId: row.restaurantId,
      branchId: row.branchId,
      tableId: row.tableId,
      reservationDate: row.reservationDate,
      reservationStartTime: row.reservationStartTime,
      reservationEndTime: row.reservationEndTime,
      guests: row.guests,
      status: row.status as ReservationStatus,
      source: row.source as ReservationSource,
      notes: row.notes,
      createdBy: row.createdBy,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt,
      cancelledAt: row.cancelledAt,
      completedAt: row.completedAt,
      noShowAt: row.noShowAt,
      lateArrivalNotifiedAt: row.lateArrivalNotifiedAt,
      tableReadyNotifiedAt: row.tableReadyNotifiedAt,
      rescheduledFromReservationId: row.rescheduledFromReservationId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };

    return Reservation.reconstitute(props);
  }

  static toPersistence(reservation: Reservation): ReservationRow {
    const props = reservation.toProps();
    return {
      id: props.id,
      userId: props.userId,
      reservationGuestId: props.reservationGuestId,
      restaurantId: props.restaurantId,
      branchId: props.branchId,
      tableId: props.tableId,
      reservationDate: props.reservationDate,
      reservationStartTime: props.reservationStartTime,
      reservationEndTime: props.reservationEndTime,
      guests: props.guests,
      status: props.status,
      source: props.source,
      notes: props.notes,
      createdBy: props.createdBy,
      approvedBy: props.approvedBy,
      approvedAt: props.approvedAt,
      cancelledAt: props.cancelledAt,
      completedAt: props.completedAt,
      noShowAt: props.noShowAt,
      lateArrivalNotifiedAt: props.lateArrivalNotifiedAt,
      tableReadyNotifiedAt: props.tableReadyNotifiedAt,
      rescheduledFromReservationId: props.rescheduledFromReservationId,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
    };
  }
}
