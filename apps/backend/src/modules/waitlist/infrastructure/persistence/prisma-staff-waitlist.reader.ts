import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { WaitlistStatus } from '../../domain/enums/waitlist.enums';
import {
  StaffWaitlistCustomerInfo,
  StaffWaitlistFilters,
  StaffWaitlistItem,
  StaffWaitlistReaderPort,
} from '../../application/ports/staff-waitlist-reader.port';

const INCLUDE = {
  user: { select: { firstName: true, lastName: true, username: true, phone: true } },
  reservationGuest: { select: { fullName: true, phone: true } },
} as const;

type WaitlistRow = Prisma.ReservationWaitlistEntryGetPayload<{ include: typeof INCLUDE }>;

/** A day's queue is small; this bounds a pathological branch, not real use. */
const MAX_ENTRIES_PER_DAY = 500;

@Injectable()
export class PrismaStaffWaitlistReader implements StaffWaitlistReaderPort {
  constructor(private readonly prismaContext: PrismaContext) {}

  async listForBranchDay(
    restaurantId: string,
    branchId: string,
    filters: StaffWaitlistFilters,
  ): Promise<StaffWaitlistItem[]> {
    const rows = await this.prismaContext.client.reservationWaitlistEntry.findMany({
      where: {
        restaurantId,
        branchId,
        preferredDate: filters.preferredDate,
        deletedAt: null,
        ...(filters.status !== undefined ? { status: filters.status } : {}),
      },
      include: INCLUDE,
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      take: MAX_ENTRIES_PER_DAY,
    });
    return rows.map((row) => this.toItem(row));
  }

  private toItem(row: WaitlistRow): StaffWaitlistItem {
    return {
      entryId: row.id,
      restaurantId: row.restaurantId,
      branchId: row.branchId,
      userId: row.userId,
      reservationGuestId: row.reservationGuestId,
      partySize: row.partySize,
      preferredDate: row.preferredDate,
      preferredTimeFrom: row.preferredTimeFrom,
      preferredTimeTo: row.preferredTimeTo,
      status: row.status as WaitlistStatus,
      position: row.position,
      convertedReservationId: row.convertedReservationId,
      notifiedAt: row.notifiedAt,
      expiresAt: row.expiresAt,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      customer: this.toCustomer(row),
    };
  }

  private toCustomer(row: WaitlistRow): StaffWaitlistCustomerInfo {
    if (row.userId !== null) {
      const name = [row.user?.firstName, row.user?.lastName].filter(Boolean).join(' ').trim();
      return {
        type: 'User',
        name: name.length > 0 ? name : (row.user?.username ?? null),
        phone: row.user?.phone ?? null,
      };
    }
    return {
      type: 'Guest',
      name: row.reservationGuest?.fullName ?? null,
      phone: row.reservationGuest?.phone ?? null,
    };
  }
}
