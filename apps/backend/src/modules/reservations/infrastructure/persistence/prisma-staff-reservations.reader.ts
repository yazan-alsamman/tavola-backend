import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { ReservationSource, ReservationStatus } from '../../domain/enums/reservation.enums';
import {
  StaffReservationCustomerInfo,
  StaffReservationItem,
  StaffReservationsFilters,
  StaffReservationsPage,
  StaffReservationsReaderPort,
} from '../../application/ports/staff-reservations-reader.port';

const INCLUDE = {
  table: { select: { id: true, tableNumber: true, capacity: true } },
  user: { select: { firstName: true, lastName: true, phone: true } },
  reservationGuest: { select: { fullName: true, phone: true } },
} as const;

type ReservationRow = Prisma.ReservationGetPayload<{ include: typeof INCLUDE }>;

/**
 * Restaurant Dashboard Calendar reader. Filters directly by `restaurantId`/
 * `branchId` (both already validated against the Employee actor's own JWT
 * claims by `ListBranchReservationsUseCase` before this is ever called) plus
 * the bounded `[dateFrom, dateTo]` window against `reservationDate` - served
 * entirely by the existing `(branchId, reservationDate, status)` composite
 * index (DATABASE_SCHEMA.md: "the primary availability-search query...
 * this composite index directly serves that query without a full scan").
 * `Reservation` is not in `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS`
 * (see `PrismaMyReservationsReader`'s own doc comment for why this is a safe
 * passthrough), and the `include` below loads Table/User/ReservationGuest as
 * part of the SAME query - one round trip, no N+1, identical reasoning to
 * `PrismaMyReservationsReader`.
 */
@Injectable()
export class PrismaStaffReservationsReader implements StaffReservationsReaderPort {
  constructor(private readonly prismaContext: PrismaContext) {}

  async search(
    restaurantId: string,
    branchId: string,
    filters: StaffReservationsFilters,
    page: number,
    limit: number,
  ): Promise<StaffReservationsPage> {
    const where: Prisma.ReservationWhereInput = {
      restaurantId,
      branchId,
      reservationDate: { gte: filters.dateFrom, lte: filters.dateTo },
      ...(filters.status !== undefined ? { status: filters.status } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prismaContext.client.reservation.findMany({
        where,
        include: INCLUDE,
        orderBy: { reservationStartTime: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaContext.client.reservation.count({ where }),
    ]);

    return { items: rows.map((row) => this.toItem(row)), total };
  }

  private toItem(row: ReservationRow): StaffReservationItem {
    return {
      reservationId: row.id,
      restaurantId: row.restaurantId,
      branchId: row.branchId,
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
      customer: this.toCustomer(row),
    };
  }

  private toCustomer(row: ReservationRow): StaffReservationCustomerInfo {
    if (row.userId !== null) {
      const name = [row.user?.firstName, row.user?.lastName].filter(Boolean).join(' ').trim();
      return { type: 'User', name: name.length > 0 ? name : null, phone: row.user?.phone ?? null };
    }
    return {
      type: 'Guest',
      name: row.reservationGuest?.fullName ?? null,
      phone: row.reservationGuest?.phone ?? null,
    };
  }
}
