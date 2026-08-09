import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { ReservationId, TableId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { Reservation } from '../../domain/entities/reservation.entity';
import { ReservationStatus } from '../../domain/enums/reservation.enums';
import { ReservationConflictException } from '../../domain/exceptions/reservation-conflict.exception';
import {
  ReservationListPage,
  ReservationRepository,
} from '../../domain/repositories/reservation.repository';
import { ReservationPrismaMapper } from './reservation.prisma-mapper';

/**
 * ADR-013: the `reservations_no_overlapping_confirmed_excl` exclusion
 * constraint is not modeled in `schema.prisma` (raw-SQL-only, see the Phase
 * 7.1 migration), so Prisma cannot recognize it as a known error code (no
 * `P2002`-style mapping) - a violation surfaces as a
 * `PrismaClientUnknownRequestError` whose `message` embeds the raw
 * PostgreSQL error, including SQLSTATE `23P01` (`exclusion_violation`) and
 * the constraint name. Matched on the constraint name specifically (not just
 * `23P01`) so only this exact constraint's violation is translated - any
 * other database error is rethrown untouched.
 */
const EXCLUSION_CONSTRAINT_NAME = 'reservations_no_overlapping_confirmed_excl';

function isReservationExclusionViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientUnknownRequestError &&
    error.message.includes(EXCLUSION_CONSTRAINT_NAME)
  );
}

const CONFIRMED_STATUSES = [
  ReservationStatus.Approved,
  ReservationStatus.Completed,
  ReservationStatus.NoShow,
];

/**
 * `Reservation` is not in `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS`
 * (customer-facing writes are not organization-scoped) - the ordinary
 * tenant-scoped `PrismaContext` client is a safe no-op passthrough here,
 * exactly like `PrismaTableRepository`/`PrismaBranchRepository`'s own doc
 * comments explain for their models.
 */
@Injectable()
export class PrismaReservationRepository implements ReservationRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findOverlappingPendingOrApproved(
    tableId: TableId,
    startTime: Date,
    endTime: Date,
  ): Promise<Reservation[]> {
    const rows = await this.prismaContext.client.reservation.findMany({
      where: {
        tableId: tableId.value,
        status: { in: [ReservationStatus.Pending, ReservationStatus.Approved] },
        reservationStartTime: { lt: endTime },
        reservationEndTime: { gt: startTime },
      },
    });

    return rows.map((row) => ReservationPrismaMapper.toDomain(row));
  }

  async findOverlappingPendingOrApprovedForTables(
    tableIds: TableId[],
    startTime: Date,
    endTime: Date,
  ): Promise<Reservation[]> {
    if (tableIds.length === 0) {
      return [];
    }
    const rows = await this.prismaContext.client.reservation.findMany({
      where: {
        tableId: { in: tableIds.map((id) => id.value) },
        status: { in: [ReservationStatus.Pending, ReservationStatus.Approved] },
        reservationStartTime: { lt: endTime },
        reservationEndTime: { gt: startTime },
      },
    });

    return rows.map((row) => ReservationPrismaMapper.toDomain(row));
  }

  /**
   * ADR-013: acquires `pg_advisory_xact_lock(hashtextextended(lockKey, 0))`,
   * re-checks for an overlapping confirmed reservation, then inserts - all
   * inside one transaction, no external I/O (CODING_STANDARDS.md's
   * short-transaction rule). The lock is released automatically when the
   * transaction commits or rolls back.
   */
  async createWithLock(reservation: Reservation, lockKey: string): Promise<void> {
    await this.prismaContext.runInTransaction(() =>
      this.createWithLockInTransaction(reservation, lockKey),
    );
  }

  /**
   * Phase 7.2: the extracted core of `createWithLock`, reusable by the
   * auto-approval branch of `CreateReservationUseCase`, which wraps this in
   * its own outer `UnitOfWorkPort.execute` block alongside `Table.reserve()`
   * and auto-rejection - see this method's own interface doc comment.
   */
  async createWithLockInTransaction(reservation: Reservation, lockKey: string): Promise<void> {
    // `$executeRaw`, not `$queryRaw`: `pg_advisory_xact_lock` returns `void`,
    // which Prisma cannot deserialize as a `$queryRaw` result column.
    await this.prismaContext.client
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

    const conflicting = await this.prismaContext.client.reservation.findFirst({
      where: {
        tableId: reservation.tableId.value,
        status: { in: CONFIRMED_STATUSES },
        reservationStartTime: { lt: reservation.reservationEndTime },
        reservationEndTime: { gt: reservation.reservationStartTime },
      },
    });

    if (conflicting !== null) {
      throw new ReservationConflictException();
    }

    const data = ReservationPrismaMapper.toPersistence(reservation);
    try {
      await this.prismaContext.client.reservation.create({ data });
    } catch (error) {
      if (isReservationExclusionViolation(error)) {
        throw new ReservationConflictException();
      }
      throw error;
    }
  }

  async findById(id: ReservationId): Promise<Reservation | null> {
    const row = await this.prismaContext.client.reservation.findUnique({
      where: { id: id.value },
    });
    return row ? ReservationPrismaMapper.toDomain(row) : null;
  }

  async acquireAdvisoryLock(lockKey: string): Promise<void> {
    await this.prismaContext.client
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
  }

  async findConfirmedOverlapExcluding(
    tableId: TableId,
    startTime: Date,
    endTime: Date,
    excludeReservationId: ReservationId,
  ): Promise<Reservation | null> {
    const row = await this.prismaContext.client.reservation.findFirst({
      where: {
        tableId: tableId.value,
        id: { not: excludeReservationId.value },
        status: { in: CONFIRMED_STATUSES },
        reservationStartTime: { lt: endTime },
        reservationEndTime: { gt: startTime },
      },
    });
    return row ? ReservationPrismaMapper.toDomain(row) : null;
  }

  async findOtherOverlappingPending(
    tableId: TableId,
    startTime: Date,
    endTime: Date,
    excludeReservationId: ReservationId,
  ): Promise<Reservation[]> {
    const rows = await this.prismaContext.client.reservation.findMany({
      where: {
        tableId: tableId.value,
        id: { not: excludeReservationId.value },
        status: ReservationStatus.Pending,
        reservationStartTime: { lt: endTime },
        reservationEndTime: { gt: startTime },
      },
    });
    return rows.map((row) => ReservationPrismaMapper.toDomain(row));
  }

  async updateTransitioningFromPending(reservation: Reservation): Promise<boolean> {
    return this.updateTransitioningFrom(reservation, ReservationStatus.Pending);
  }

  async updateTransitioningFrom(
    reservation: Reservation,
    expectedCurrentStatus: ReservationStatus,
  ): Promise<boolean> {
    const data = ReservationPrismaMapper.toPersistence(reservation);
    try {
      const result = await this.prismaContext.client.reservation.updateMany({
        where: { id: data.id, status: expectedCurrentStatus },
        data: {
          status: data.status,
          tableId: data.tableId,
          reservationDate: data.reservationDate,
          reservationStartTime: data.reservationStartTime,
          reservationEndTime: data.reservationEndTime,
          guests: data.guests,
          notes: data.notes,
          approvedBy: data.approvedBy,
          approvedAt: data.approvedAt,
          cancelledAt: data.cancelledAt,
          completedAt: data.completedAt,
          noShowAt: data.noShowAt,
          lateArrivalNotifiedAt: data.lateArrivalNotifiedAt,
          tableReadyNotifiedAt: data.tableReadyNotifiedAt,
          updatedAt: data.updatedAt,
        },
      });
      return result.count > 0;
    } catch (error) {
      if (isReservationExclusionViolation(error)) {
        throw new ReservationConflictException();
      }
      throw error;
    }
  }

  async markLateArrivalNotifiedIfEligible(id: ReservationId, at: Date): Promise<boolean> {
    const result = await this.prismaContext.client.reservation.updateMany({
      where: { id: id.value, status: ReservationStatus.Approved, lateArrivalNotifiedAt: null },
      data: { lateArrivalNotifiedAt: at, updatedAt: at },
    });
    return result.count > 0;
  }

  async markTableReadyNotifiedIfEligible(id: ReservationId, at: Date): Promise<boolean> {
    const result = await this.prismaContext.client.reservation.updateMany({
      where: { id: id.value, status: ReservationStatus.Approved, tableReadyNotifiedAt: null },
      data: { tableReadyNotifiedAt: at, updatedAt: at },
    });
    return result.count > 0;
  }

  async hasBlockingReservation(tableId: TableId, now: Date): Promise<boolean> {
    const count = await this.prismaContext.client.reservation.count({
      where: {
        tableId: tableId.value,
        status: { in: [ReservationStatus.Pending, ReservationStatus.Approved] },
        reservationEndTime: { gt: now },
      },
    });
    return count > 0;
  }

  async findBlockedTableIds(tableIds: TableId[], now: Date): Promise<TableId[]> {
    if (tableIds.length === 0) {
      return [];
    }
    const rows = await this.prismaContext.client.reservation.findMany({
      where: {
        tableId: { in: tableIds.map((id) => id.value) },
        status: { in: [ReservationStatus.Pending, ReservationStatus.Approved] },
        reservationEndTime: { gt: now },
      },
      select: { tableId: true },
      distinct: ['tableId'],
    });
    return rows.map((row) => TableId.create(row.tableId));
  }

  async findManyByUserId(
    userId: UserId,
    page: number,
    limit: number,
  ): Promise<ReservationListPage> {
    const [rows, total] = await Promise.all([
      this.prismaContext.client.reservation.findMany({
        where: { userId: userId.value },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaContext.client.reservation.count({ where: { userId: userId.value } }),
    ]);
    return { items: rows.map((row) => ReservationPrismaMapper.toDomain(row)), total };
  }

  async hasOpenReservationsByUserId(userId: UserId, now: Date): Promise<boolean> {
    const count = await this.prismaContext.client.reservation.count({
      where: {
        userId: userId.value,
        status: { in: [ReservationStatus.Pending, ReservationStatus.Approved] },
        reservationEndTime: { gt: now },
      },
    });
    return count > 0;
  }
}
