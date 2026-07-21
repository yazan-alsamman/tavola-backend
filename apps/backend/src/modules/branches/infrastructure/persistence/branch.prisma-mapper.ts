import { Branch as PrismaBranch } from '@prisma/client';
import { Branch as BranchEntity } from '../../domain/entities/branch.entity';

export class BranchPrismaMapper {
  static toDomain(row: PrismaBranch): BranchEntity {
    return BranchEntity.reconstitute({
      id: row.id,
      restaurantId: row.restaurantId,
      city: row.city,
      district: row.district,
      address: row.address,
      latitude: row.latitude === null ? null : row.latitude.toNumber(),
      longitude: row.longitude === null ? null : row.longitude.toNumber(),
      countryCode: row.countryCode,
      currency: row.currency,
      timezone: row.timezone,
      phone: row.phone,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    });
  }

  /**
   * `latitude`/`longitude` are returned as plain `number | null` here (not
   * `Prisma.Decimal`) - Prisma's write-side input types for a `Decimal`
   * column accept `number | string | Decimal`, so callers pass this straight
   * through to `create`/`update` `data` without constructing a `Decimal`,
   * matching `RestaurantPrismaMapper.toPersistence`'s own `averageRating`
   * precedent. `openingHours` remains absent from this write payload (Phase
   * 5.2 resolved branch-level working hours via a separate `BranchWorkingHours`
   * table instead) - Prisma leaves an omitted nullable column untouched.
   */
  static toPersistence(branch: BranchEntity): {
    id: string;
    restaurantId: string;
    city: string;
    district: string | null;
    address: string;
    latitude: number | null;
    longitude: number | null;
    countryCode: string;
    currency: string | null;
    timezone: string;
    phone: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  } {
    const props = branch.toProps();
    return {
      id: props.id,
      restaurantId: props.restaurantId,
      city: props.city,
      district: props.district,
      address: props.address,
      latitude: props.latitude,
      longitude: props.longitude,
      countryCode: props.countryCode,
      currency: props.currency,
      timezone: props.timezone,
      phone: props.phone,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
      deletedAt: props.deletedAt,
    };
  }
}
