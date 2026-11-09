import { Offer as PrismaOffer } from '@prisma/client';
import { Offer as OfferEntity } from '../../domain/entities/offer.entity';
import { OfferDiscountType, OfferStatus, OfferType } from '../../domain/enums/offer.enums';

export class OfferPrismaMapper {
  static toDomain(row: PrismaOffer): OfferEntity {
    return OfferEntity.reconstitute({
      id: row.id,
      restaurantId: row.restaurantId,
      type: row.type as OfferType,
      title: row.title,
      description: row.description,
      discountType: row.discountType as OfferDiscountType,
      discountValue: row.discountValue.toNumber(),
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      status: row.status as OfferStatus,
      daysOfWeek: row.daysOfWeek,
      startTime: row.startTime,
      endTime: row.endTime,
      minPartySize: row.minPartySize,
      branchIds: row.branchIds,
      oncePerCustomer: row.oncePerCustomer,
      bookingCap: row.bookingCap,
      viewCount: row.viewCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    });
  }

  /**
   * `discountValue` is returned as a plain `number` (not `Prisma.Decimal`) -
   * Prisma's write-side input type for a `Decimal` column accepts `number |
   * string | Decimal`, matching `BranchPrismaMapper.toPersistence`'s own
   * `latitude`/`longitude` precedent.
   */
  static toPersistence(offer: OfferEntity): {
    id: string;
    restaurantId: string;
    type: OfferType;
    title: string;
    description: string;
    discountType: OfferDiscountType;
    discountValue: number;
    startsAt: Date;
    endsAt: Date;
    status: OfferStatus;
    daysOfWeek: number[];
    startTime: string | null;
    endTime: string | null;
    minPartySize: number | null;
    branchIds: string[];
    oncePerCustomer: boolean;
    bookingCap: number | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  } {
    const props = offer.toProps();
    return {
      id: props.id,
      restaurantId: props.restaurantId,
      type: props.type,
      title: props.title,
      description: props.description,
      discountType: props.discountType,
      discountValue: props.discountValue,
      startsAt: props.startsAt,
      endsAt: props.endsAt,
      status: props.status,
      daysOfWeek: props.daysOfWeek,
      startTime: props.startTime,
      endTime: props.endTime,
      minPartySize: props.minPartySize,
      branchIds: props.branchIds,
      oncePerCustomer: props.oncePerCustomer,
      bookingCap: props.bookingCap,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
      deletedAt: props.deletedAt,
    };
  }
}
