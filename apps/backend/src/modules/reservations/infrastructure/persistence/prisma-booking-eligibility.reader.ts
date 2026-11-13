import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { ReservationStatus } from '../../domain/enums/reservation.enums';
import { BookingEligibilityReaderPort } from '../../application/ports/booking-eligibility-reader.port';

const ACTIVE_RESTAURANT_STATUS = 'Active';

@Injectable()
export class PrismaBookingEligibilityReader implements BookingEligibilityReaderPort {
  constructor(private readonly prismaContext: PrismaContext) {}

  async isRestaurantAcceptingReservations(restaurantId: string): Promise<boolean> {
    // Raw query: `Restaurant` is a tenant-scoped model and a Customer has no
    // tenant context - same reason as `existsPubliclyById`.
    const rows = await this.prismaContext.client.$queryRaw<{ accepting: boolean }[]>`
      SELECT EXISTS(
        SELECT 1 FROM restaurants
        WHERE id = ${restaurantId}::uuid
          AND deleted_at IS NULL
          AND status = ${ACTIVE_RESTAURANT_STATUS}
      ) AS "accepting"
    `;
    return rows[0]?.accepting ?? false;
  }

  countUpcomingActiveForUser(userId: string, now: Date): Promise<number> {
    return this.prismaContext.client.reservation.count({
      where: {
        userId,
        status: { in: [ReservationStatus.Pending, ReservationStatus.Approved] },
        reservationEndTime: { gt: now },
      },
    });
  }

  async sumActiveGuestsForBranchBetween(branchId: string, from: Date, to: Date): Promise<number> {
    const result = await this.prismaContext.client.reservation.aggregate({
      _sum: { guests: true },
      where: {
        branchId,
        status: { in: [ReservationStatus.Pending, ReservationStatus.Approved] },
        reservationStartTime: { gte: from, lt: to },
      },
    });
    return result._sum.guests ?? 0;
  }
}
