import { Injectable } from '@nestjs/common';
import { OfferStatus, Prisma, ReservationStatus } from '@prisma/client';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { offerAcceptsBooking } from '@modules/offers/domain/policies/offer-conditions.policy';
import {
  OfferAttributionBooking,
  OfferAttributionReaderPort,
} from '../../application/ports/offer-attribution-reader.port';

/** Bookings that no longer hold their place do not use up an offer. */
const RELEASED_STATUSES: ReservationStatus[] = [
  ReservationStatus.Rejected,
  ReservationStatus.Cancelled,
  ReservationStatus.Expired,
];

/**
 * `Offer` is not a tenant-scoped model (it hangs off Restaurant), so a plain
 * lookup is safe for a Customer actor; the `restaurantId` filter is what
 * keeps a foreign restaurant's offer from being attached. The period, days,
 * hours, branch and party conditions come from the Offers domain policy
 * (ADR-047); the counted ones are checked here. Two simultaneous bookings
 * can both take the last place under a cap: the cap is a business limit,
 * not a seat lock.
 */
@Injectable()
export class PrismaOfferAttributionReader implements OfferAttributionReaderPort {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findAttributableOfferId(
    offerId: string,
    restaurantId: string,
    at: Date,
    booking: OfferAttributionBooking,
  ): Promise<string | null> {
    const offer = await this.prismaContext.client.offer.findFirst({
      where: {
        id: offerId,
        restaurantId,
        deletedAt: null,
        status: OfferStatus.Published,
        startsAt: { lte: at },
        endsAt: { gt: at },
      },
    });
    if (offer === null || !offerAcceptsBooking(offer, booking)) {
      return null;
    }

    const live: Prisma.ReservationWhereInput = {
      offerId,
      status: { notIn: RELEASED_STATUSES },
    };

    if (offer.bookingCap !== null) {
      const used = await this.prismaContext.client.reservation.count({ where: live });
      if (used >= offer.bookingCap) {
        return null;
      }
    }

    if (offer.oncePerCustomer) {
      const sameGuest: Prisma.ReservationWhereInput | null = booking.userId
        ? { userId: booking.userId }
        : booking.guestPhone
          ? { userId: null, reservationGuest: { phone: booking.guestPhone } }
          : null;
      if (sameGuest !== null) {
        const before = await this.prismaContext.client.reservation.count({
          where: { ...live, ...sameGuest },
        });
        if (before > 0) {
          return null;
        }
      }
    }

    return offer.id;
  }
}
