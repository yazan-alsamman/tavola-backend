import { Injectable } from '@nestjs/common';
import { OfferStatus } from '@prisma/client';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { OfferAttributionReaderPort } from '../../application/ports/offer-attribution-reader.port';

/**
 * `Offer` is not a tenant-scoped model (it hangs off Restaurant), so a plain
 * lookup is safe for a Customer actor; the `restaurantId` filter is what
 * keeps a foreign restaurant's offer from being attached.
 */
@Injectable()
export class PrismaOfferAttributionReader implements OfferAttributionReaderPort {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findAttributableOfferId(
    offerId: string,
    restaurantId: string,
    at: Date,
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
      select: { id: true },
    });
    return offer?.id ?? null;
  }
}
