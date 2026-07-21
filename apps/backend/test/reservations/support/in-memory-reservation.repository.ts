import { Reservation } from '@modules/reservations/domain/entities/reservation.entity';
import { ReservationStatus } from '@modules/reservations/domain/enums/reservation.enums';
import { ReservationConflictException } from '@modules/reservations/domain/exceptions/reservation-conflict.exception';
import { ReservationRepository } from '@modules/reservations/domain/repositories/reservation.repository';
import { TableId } from '@shared/domain/value-objects/identifiers.vo';

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}

export class InMemoryReservationRepository {
  private readonly rows = new Map<string, Reservation>();
  public readonly acquiredLockKeys: string[] = [];

  async findOverlappingPendingOrApproved(
    tableId: TableId,
    startTime: Date,
    endTime: Date,
  ): Promise<Reservation[]> {
    return [...this.rows.values()].filter(
      (row) =>
        row.tableId.value === tableId.value &&
        (row.status === ReservationStatus.Pending || row.status === ReservationStatus.Approved) &&
        overlaps(row.reservationStartTime, row.reservationEndTime, startTime, endTime),
    );
  }

  async createWithLock(reservation: Reservation, lockKey: string): Promise<void> {
    this.acquiredLockKeys.push(lockKey);

    const conflicting = [...this.rows.values()].some(
      (row) =>
        row.tableId.value === reservation.tableId.value &&
        (row.status === ReservationStatus.Approved ||
          row.status === ReservationStatus.Completed ||
          row.status === ReservationStatus.NoShow) &&
        overlaps(
          row.reservationStartTime,
          row.reservationEndTime,
          reservation.reservationStartTime,
          reservation.reservationEndTime,
        ),
    );
    if (conflicting) {
      throw new ReservationConflictException();
    }

    this.rows.set(reservation.reservationId.value, reservation);
  }

  /** Test-only helper: seeds a row directly, bypassing createWithLock's conflict check. */
  seed(reservation: Reservation): void {
    this.rows.set(reservation.reservationId.value, reservation);
  }
}

// Type-check that the fake actually satisfies the real interface.
const _typeCheck: ReservationRepository = new InMemoryReservationRepository();
void _typeCheck;
