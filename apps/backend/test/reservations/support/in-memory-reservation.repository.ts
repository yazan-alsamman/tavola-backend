import { Reservation } from '@modules/reservations/domain/entities/reservation.entity';
import { ReservationStatus } from '@modules/reservations/domain/enums/reservation.enums';
import { ReservationConflictException } from '@modules/reservations/domain/exceptions/reservation-conflict.exception';
import {
  ReservationListPage,
  ReservationRepository,
} from '@modules/reservations/domain/repositories/reservation.repository';
import { ReservationId, TableId, UserId } from '@shared/domain/value-objects/identifiers.vo';

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

  async findOverlappingPendingOrApprovedForTables(
    tableIds: TableId[],
    startTime: Date,
    endTime: Date,
  ): Promise<Reservation[]> {
    const ids = new Set(tableIds.map((id) => id.value));
    return [...this.rows.values()].filter(
      (row) =>
        ids.has(row.tableId.value) &&
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

  async markLateArrivalNotifiedIfEligible(id: ReservationId, at: Date): Promise<boolean> {
    const current = this.rows.get(id.value);
    if (
      !current ||
      current.status !== ReservationStatus.Approved ||
      current.lateArrivalNotifiedAt !== null
    ) {
      return false;
    }
    this.rows.set(
      id.value,
      Reservation.reconstitute({ ...current.toProps(), lateArrivalNotifiedAt: at, updatedAt: at }),
    );
    return true;
  }

  async markTableReadyNotifiedIfEligible(id: ReservationId, at: Date): Promise<boolean> {
    const current = this.rows.get(id.value);
    if (
      !current ||
      current.status !== ReservationStatus.Approved ||
      current.tableReadyNotifiedAt !== null
    ) {
      return false;
    }
    this.rows.set(
      id.value,
      Reservation.reconstitute({ ...current.toProps(), tableReadyNotifiedAt: at, updatedAt: at }),
    );
    return true;
  }

  async hasBlockingReservation(tableId: TableId, now: Date): Promise<boolean> {
    return [...this.rows.values()].some(
      (row) =>
        row.tableId.value === tableId.value &&
        (row.status === ReservationStatus.Pending || row.status === ReservationStatus.Approved) &&
        row.reservationEndTime.getTime() > now.getTime(),
    );
  }

  async findBlockedTableIds(tableIds: TableId[], now: Date): Promise<TableId[]> {
    const requested = new Set(tableIds.map((id) => id.value));
    const blocked = new Set(
      [...this.rows.values()]
        .filter(
          (row) =>
            requested.has(row.tableId.value) &&
            (row.status === ReservationStatus.Pending ||
              row.status === ReservationStatus.Approved) &&
            row.reservationEndTime.getTime() > now.getTime(),
        )
        .map((row) => row.tableId.value),
    );
    return tableIds.filter((id) => blocked.has(id.value));
  }

  async findManyByUserId(
    userId: UserId,
    page: number,
    limit: number,
  ): Promise<ReservationListPage> {
    const all = [...this.rows.values()]
      .filter((row) => row.userId?.value === userId.value)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (page - 1) * limit;
    return { items: all.slice(start, start + limit), total: all.length };
  }

  /** Test-only helper: seeds a row directly, bypassing createWithLock's conflict check. */
  seed(reservation: Reservation): void {
    this.rows.set(reservation.reservationId.value, reservation);
  }
}

// Type-check that the fake actually satisfies the real interface.
const _typeCheck: ReservationRepository = new InMemoryReservationRepository();
void _typeCheck;
