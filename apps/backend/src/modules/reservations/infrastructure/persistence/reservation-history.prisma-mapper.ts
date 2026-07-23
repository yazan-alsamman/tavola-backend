import { ReservationHistory as PrismaReservationHistoryRow } from '@prisma/client';
import {
  ReservationHistory,
  ReservationHistoryProps,
} from '../../domain/entities/reservation-history.entity';
import { ReservationStatus } from '../../domain/enums/reservation.enums';

export type ReservationHistoryRow = PrismaReservationHistoryRow;

export class ReservationHistoryPrismaMapper {
  static toDomain(row: ReservationHistoryRow): ReservationHistory {
    const props: ReservationHistoryProps = {
      id: row.id,
      reservationId: row.reservationId,
      oldStatus: row.oldStatus as ReservationStatus,
      newStatus: row.newStatus as ReservationStatus,
      oldReservationDate: row.oldReservationDate,
      oldReservationStartTime: row.oldReservationStartTime,
      newReservationDate: row.newReservationDate,
      newReservationStartTime: row.newReservationStartTime,
      oldTableId: row.oldTableId,
      newTableId: row.newTableId,
      withinCancellationWindow: row.withinCancellationWindow,
      changedBy: row.changedBy,
      changedAt: row.changedAt,
      reason: row.reason,
    };
    return ReservationHistory.create(props);
  }

  static toPersistence(history: ReservationHistory): ReservationHistoryRow {
    const props = history.toProps();
    return {
      id: props.id,
      reservationId: props.reservationId,
      oldStatus: props.oldStatus,
      newStatus: props.newStatus,
      oldReservationDate: props.oldReservationDate,
      oldReservationStartTime: props.oldReservationStartTime,
      newReservationDate: props.newReservationDate,
      newReservationStartTime: props.newReservationStartTime,
      oldTableId: props.oldTableId,
      newTableId: props.newTableId,
      withinCancellationWindow: props.withinCancellationWindow,
      changedBy: props.changedBy,
      changedAt: props.changedAt,
      reason: props.reason,
    };
  }
}
