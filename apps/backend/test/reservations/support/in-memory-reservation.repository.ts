import { Reservation } from '@modules/reservations/domain/entities/reservation.entity';
import { ReservationStatus } from '@modules/reservations/domain/enums/reservation.enums';
import { ReservationConflictException } from '@modules/reservations/domain/exceptions/reservation-conflict.exception';
import { ReservationRepository } from '@modules/reservations/domain/repositories/reservation.repository';
import { ReservationId, TableId } from '@shared/domain/value-objects/identifiers.vo';

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}

const CONFIRMED_STATUSES = [
  ReservationStatus.Approved,
  ReservationStatus.Completed,
  ReservationStatus.NoShow,
];

export class InMemoryReservationRepository implements ReservationRepository {
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
    await this.createWithLockInTransaction(reservation, lockKey);
  }

  async createWithLockInTransaction(reservation: Reservation, lockKey: string): Promise<void> {
    this.acquiredLockKeys.push(lockKey);

    const conflicting = [...this.rows.values()].some(
      (row) =>
        row.tableId.value === reservation.tableId.value &&
        CONFIRMED_STATUSES.includes(row.status) &&
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

  async findById(id: ReservationId): Promise<Reservation | null> {
    return this.rows.get(id.value) ?? null;
  }

  async acquireAdvisoryLock(lockKey: string): Promise<void> {
    this.acquiredLockKeys.push(lockKey);
  }

  async findConfirmedOverlapExcluding(
    tableId: TableId,
    startTime: Date,
    endTime: Date,
    excludeReservationId: ReservationId,
  ): Promise<Reservation | null> {
    const match = [...this.rows.values()].find(
      (row) =>
        row.tableId.value === tableId.value &&
        row.reservationId.value !== excludeReservationId.value &&
        CONFIRMED_STATUSES.includes(row.status) &&
        overlaps(row.reservationStartTime, row.reservationEndTime, startTime, endTime),
    );
    return match ?? null;
  }

  async findOtherOverlappingPending(
    tableId: TableId,
    startTime: Date,
    endTime: Date,
    excludeReservationId: ReservationId,
  ): Promise<Reservation[]> {
    return [...this.rows.values()].filter(
      (row) =>
        row.tableId.value === tableId.value &&
        row.reservationId.value !== excludeReservationId.value &&
        row.status === ReservationStatus.Pending &&
        overlaps(row.reservationStartTime, row.reservationEndTime, startTime, endTime),
    );
  }

  async updateTransitioningFromPending(reservation: Reservation): Promise<boolean> {
    return this.updateTransitioningFrom(reservation, ReservationStatus.Pending);
  }

  async updateTransitioningFrom(
    reservation: Reservation,
    expectedCurrentStatus: ReservationStatus,
  ): Promise<boolean> {
    const current = this.rows.get(reservation.reservationId.value);
    if (!current || current.status !== expectedCurrentStatus) {
      return false;
    }
    const conflicting = [...this.rows.values()].some(
      (row) =>
        row.reservationId.value !== reservation.reservationId.value &&
        row.tableId.value === reservation.tableId.value &&
        CONFIRMED_STATUSES.includes(row.status) &&
        overlaps(
          row.reservationStartTime,
          row.reservationEndTime,
          reservation.reservationStartTime,
          reservation.reservationEndTime,
        ),
    );
    if (conflicting && CONFIRMED_STATUSES.includes(reservation.status)) {
      throw new ReservationConflictException();
    }
    this.rows.set(reservation.reservationId.value, reservation);
    return true;
  }

  /** Test-only helper: seeds a row directly, bypassing createWithLock's conflict check. */
  seed(reservation: Reservation): void {
    this.rows.set(reservation.reservationId.value, reservation);
  }
}

// Type-check that the fake actually satisfies the real interface.
const _typeCheck: ReservationRepository = new InMemoryReservationRepository();
void _typeCheck;
