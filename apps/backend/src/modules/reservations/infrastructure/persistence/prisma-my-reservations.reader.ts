import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { ReservationSource, ReservationStatus } from '../../domain/enums/reservation.enums';
import {
  MyReservationItem,
  MyReservationsFilters,
  MyReservationsPage,
  MyReservationsReaderPort,
  MyReservationsSort,
  MyReservationsSortOrder,
  MyReservationTemporalScope,
} from '../../application/ports/my-reservations-reader.port';

const INCLUDE = {
  restaurant: { select: { name: true, coverImageId: true } },
  branch: { select: { address: true } },
  table: { select: { id: true, tableNumber: true, capacity: true } },
} as const;

type ReservationRow = Prisma.ReservationGetPayload<{ include: typeof INCLUDE }>;

const ACTIVE_STATUSES = [ReservationStatus.Pending, ReservationStatus.Approved];
const TERMINAL_STATUSES = [
  ReservationStatus.Rejected,
  ReservationStatus.Cancelled,
  ReservationStatus.Completed,
  ReservationStatus.Expired,
  ReservationStatus.NoShow,
];

/**
 * `Reservation` is not in `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS`
 * (see `PrismaReservationRepository`'s own doc comment), so
 * `prismaContext.client.reservation.findMany` is a safe passthrough with no
 * bound `TenantContext` required - exactly like every other Reservation
 * query in this module. The `include` below loads `Restaurant`/`Branch`/
 * `Table` as part of the SAME query (one round trip, no N+1): a Prisma
 * Client Extension's `$allOperations` hook only ever sees the ROOT model of
 * a query (`model: 'Reservation'`, the only value `DIRECT_TENANT_OWNED_MODELS`
 * would need to contain for this to matter) - an `include`d relation is
 * resolved by the query engine itself, never as a separate intercepted
 * `model: 'Restaurant'` operation, so this never touches (or needs to
 * bypass) tenant-scoping enforcement at all, unlike
 * `PrismaRestaurantDirectoryReader`/`PrismaDiscoveryReader`'s genuine
 * cross-tenant-boundary reads.
 *
 * Deliberately does not filter out a soft-deleted or Suspended Restaurant
 * (see `MyReservationsReaderPort`'s own doc comment) - the Customer's own
 * past reservation must remain visible regardless of the restaurant's
 * current status.
 *
 * One `search` method backs `GET /reservations/my` (`all`), `/my/upcoming`,
 * and `/my/history` - `scope` only ever changes the `WHERE` clause built
 * here, never the query shape, so there is exactly one join query to keep
 * correct (see `MyReservationsReaderPort`'s own "reuse... avoid
 * duplication" doc comment).
 */
@Injectable()
export class PrismaMyReservationsReader implements MyReservationsReaderPort {
  constructor(private readonly prismaContext: PrismaContext) {}

  async search(
    userId: string,
    scope: MyReservationTemporalScope,
    filters: MyReservationsFilters,
    page: number,
    limit: number,
    sort: MyReservationsSort,
    order: MyReservationsSortOrder,
    now: Date,
  ): Promise<MyReservationsPage> {
    const where = this.buildWhere(userId, scope, filters, now);
    const orderBy = { [sort]: order } as Prisma.ReservationOrderByWithRelationInput;

    const [rows, total] = await Promise.all([
      this.prismaContext.client.reservation.findMany({
        where,
        include: INCLUDE,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaContext.client.reservation.count({ where }),
    ]);

    return { items: rows.map((row) => this.toItem(row)), total };
  }

  private buildWhere(
    userId: string,
    scope: MyReservationTemporalScope,
    filters: MyReservationsFilters,
    now: Date,
  ): Prisma.ReservationWhereInput {
    const where: Prisma.ReservationWhereInput = { userId };

    if (filters.restaurantId !== undefined) {
      where.restaurantId = filters.restaurantId;
    }
    if (filters.branchId !== undefined) {
      where.branchId = filters.branchId;
    }
    if (filters.dateFrom !== undefined || filters.dateTo !== undefined) {
      where.reservationDate = {
        ...(filters.dateFrom !== undefined ? { gte: filters.dateFrom } : {}),
        ...(filters.dateTo !== undefined ? { lte: filters.dateTo } : {}),
      };
    }

    if (scope === 'upcoming') {
      where.status = { in: ACTIVE_STATUSES };
      where.reservationStartTime = { gt: now };
    } else if (scope === 'history') {
      // The exact complement of `upcoming` (see the port's own doc
      // comment): either a terminal status, or still-active but already
      // past its scheduled time.
      where.OR = [
        { status: { in: TERMINAL_STATUSES } },
        { status: { in: ACTIVE_STATUSES }, reservationStartTime: { lte: now } },
      ];
    } else if (filters.status !== undefined) {
      where.status = filters.status;
    }

    return where;
  }

  private toItem(row: ReservationRow): MyReservationItem {
    return {
      reservationId: row.id,
      restaurantId: row.restaurantId,
      restaurantName: row.restaurant.name,
      restaurantImage: row.restaurant.coverImageId,
      branchId: row.branchId,
      branchName: row.branch.address,
      reservationDate: row.reservationDate,
      reservationStartTime: row.reservationStartTime,
      reservationEndTime: row.reservationEndTime,
      partySize: row.guests,
      status: row.status as ReservationStatus,
      reservationSource: row.source as ReservationSource,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      specialRequest: row.notes,
      table: {
        tableId: row.table.id,
        tableNumber: row.table.tableNumber,
        capacity: row.table.capacity,
      },
    };
  }
}
