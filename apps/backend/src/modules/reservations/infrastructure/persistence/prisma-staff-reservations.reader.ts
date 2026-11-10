import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { ReservationSource, ReservationStatus } from '../../domain/enums/reservation.enums';
import {
  StaffReservationActorKind,
  StaffReservationCustomerInfo,
  StaffReservationCustomerKey,
  StaffReservationItem,
  StaffReservationsFilters,
  StaffReservationsPage,
  StaffReservationsReaderPort,
  StaffReservationStatusChange,
} from '../../application/ports/staff-reservations-reader.port';

/** Statuses a reservation can settle in; their latest history row explains how. */
const FINAL_STATUSES = [
  ReservationStatus.Rejected,
  ReservationStatus.Cancelled,
  ReservationStatus.Completed,
  ReservationStatus.Expired,
  ReservationStatus.NoShow,
];

/** Same default `RestaurantSettings.pendingReservationTimeoutMinutes` falls back to on create. */
const DEFAULT_PENDING_TIMEOUT_MINUTES = 15;

const INCLUDE = {
  table: { select: { id: true, tableNumber: true, capacity: true } },
  user: { select: { firstName: true, lastName: true, phone: true } },
  reservationGuest: { select: { fullName: true, phone: true } },
  offer: { select: { id: true, title: true } },
  history: {
    where: { newStatus: { in: FINAL_STATUSES } },
    orderBy: { changedAt: 'desc' },
    take: 1,
    select: { newStatus: true, changedBy: true, changedAt: true, reason: true },
  },
} as const;

interface CustomerTally {
  visits: number;
  noShows: number;
}

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
      ...this.customerWhere(filters.customerKey),
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

    const [tallies, pendingTimeoutMinutes] = await Promise.all([
      this.tallyCustomers(restaurantId, rows),
      rows.some((row) => row.status === ReservationStatus.Pending)
        ? this.pendingTimeoutMinutes(restaurantId)
        : Promise.resolve(DEFAULT_PENDING_TIMEOUT_MINUTES),
    ]);

    return {
      items: rows.map((row) => this.toItem(row, tallies, pendingTimeoutMinutes)),
      total,
    };
  }

  private customerWhere(
    key: StaffReservationCustomerKey | undefined,
  ): Prisma.ReservationWhereInput {
    if (key === undefined) return {};
    return key.type === 'User'
      ? { userId: key.userId }
      : { userId: null, reservationGuest: { phone: key.phone } };
  }

  private async pendingTimeoutMinutes(restaurantId: string): Promise<number> {
    const settings = await this.prismaContext.client.restaurantSettings.findUnique({
      where: { restaurantId },
      select: { pendingReservationTimeoutMinutes: true },
    });
    return settings?.pendingReservationTimeoutMinutes ?? DEFAULT_PENDING_TIMEOUT_MINUTES;
  }

  /**
   * Visit and no-show counts for every customer on this page, across all of
   * the restaurant's branches - two grouped queries for the whole page (one
   * for registered users, one for phone guests), never one per row.
   */
  private async tallyCustomers(
    restaurantId: string,
    rows: ReservationRow[],
  ): Promise<Map<string, CustomerTally>> {
    const tallies = new Map<string, CustomerTally>();
    const userIds = [...new Set(rows.flatMap((row) => (row.userId ? [row.userId] : [])))];
    const phones = [
      ...new Set(
        rows.flatMap((row) =>
          row.userId === null && row.reservationGuest?.phone ? [row.reservationGuest.phone] : [],
        ),
      ),
    ];
    const counted = [ReservationStatus.Completed, ReservationStatus.NoShow];

    const bump = (key: string, status: string, count: number): void => {
      const tally = tallies.get(key) ?? { visits: 0, noShows: 0 };
      if (status === ReservationStatus.Completed) tally.visits += count;
      if (status === ReservationStatus.NoShow) tally.noShows += count;
      tallies.set(key, tally);
    };

    const [userGroups, guestRows] = await Promise.all([
      userIds.length === 0
        ? Promise.resolve([])
        : this.prismaContext.client.reservation.groupBy({
            by: ['userId', 'status'],
            where: { restaurantId, userId: { in: userIds }, status: { in: counted } },
            _count: { _all: true },
          }),
      phones.length === 0
        ? Promise.resolve([])
        : this.prismaContext.client.reservation.findMany({
            where: {
              restaurantId,
              userId: null,
              status: { in: counted },
              reservationGuest: { phone: { in: phones } },
            },
            select: { status: true, reservationGuest: { select: { phone: true } } },
          }),
    ]);

    for (const group of userGroups) {
      if (group.userId) bump(`user:${group.userId}`, group.status, group._count._all);
    }
    for (const row of guestRows) {
      if (row.reservationGuest?.phone) bump(`guest:${row.reservationGuest.phone}`, row.status, 1);
    }
    return tallies;
  }

  private toItem(
    row: ReservationRow,
    tallies: Map<string, CustomerTally>,
    pendingTimeoutMinutes: number,
  ): StaffReservationItem {
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
      customer: this.toCustomer(row, tallies),
      offer: row.offer ? { offerId: row.offer.id, title: row.offer.title } : null,
      internalNote: row.internalNote,
      approvalDeadlineAt:
        row.status === ReservationStatus.Pending
          ? new Date(row.reservationStartTime.getTime() + pendingTimeoutMinutes * 60_000)
          : null,
      statusChange: this.toStatusChange(row),
    };
  }

  private toStatusChange(row: ReservationRow): StaffReservationStatusChange | null {
    const latest = row.history[0];
    if (latest === undefined || latest.newStatus !== row.status) return null;
    return {
      status: latest.newStatus as ReservationStatus,
      changedBy: this.actorKind(latest.changedBy, row.userId),
      reason: latest.reason,
      changedAt: latest.changedAt,
    };
  }

  /**
   * A history row's `changedBy` is the customer's user id when they acted
   * themselves, a staff id (Employee or Owner/Admin user) when the
   * restaurant did, and null for the background jobs (expiry, auto-reject).
   */
  private actorKind(
    changedBy: string | null,
    customerUserId: string | null,
  ): StaffReservationActorKind {
    if (changedBy === null) return 'System';
    if (customerUserId !== null && changedBy === customerUserId) return 'Customer';
    return 'Restaurant';
  }

  private toCustomer(
    row: ReservationRow,
    tallies: Map<string, CustomerTally>,
  ): StaffReservationCustomerInfo {
    if (row.userId !== null) {
      const name = [row.user?.firstName, row.user?.lastName].filter(Boolean).join(' ').trim();
      const key = `user:${row.userId}`;
      const tally = tallies.get(key);
      return {
        type: 'User',
        name: name.length > 0 ? name : null,
        phone: row.user?.phone ?? null,
        key,
        visitCount: tally?.visits ?? 0,
        noShowCount: tally?.noShows ?? 0,
      };
    }
    const phone = row.reservationGuest?.phone ?? null;
    const key = phone ? `guest:${phone}` : null;
    const tally = key ? tallies.get(key) : undefined;
    return {
      type: 'Guest',
      name: row.reservationGuest?.fullName ?? null,
      phone,
      key,
      visitCount: tally?.visits ?? 0,
      noShowCount: tally?.noShows ?? 0,
    };
  }
}
