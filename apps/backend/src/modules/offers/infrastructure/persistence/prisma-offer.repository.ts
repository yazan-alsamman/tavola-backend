import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { OfferId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { Offer } from '../../domain/entities/offer.entity';
import { OfferStatus } from '../../domain/enums/offer.enums';
import { OfferListPage, OfferRepository } from '../../domain/repositories/offer.repository';
import { OfferPrismaMapper } from './offer.prisma-mapper';

/**
 * `Offer` is not in `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS`
 * (management-mutation tenant isolation is resolved by the calling use case
 * via `RestaurantRepository` first) - the ordinary tenant-scoped
 * `PrismaContext` client is a safe no-op passthrough here, exactly like
 * `PrismaReviewRepository`'s own doc comment explains for `Review`.
 */
@Injectable()
export class PrismaOfferRepository implements OfferRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async create(offer: Offer): Promise<void> {
    const data = OfferPrismaMapper.toPersistence(offer);
    await this.prismaContext.client.offer.create({ data });
  }

  async findByIdAndRestaurantId(id: OfferId, restaurantId: RestaurantId): Promise<Offer | null> {
    const row = await this.prismaContext.client.offer.findFirst({
      where: { id: id.value, restaurantId: restaurantId.value, deletedAt: null },
    });
    return row ? OfferPrismaMapper.toDomain(row) : null;
  }

  async findById(id: OfferId): Promise<Offer | null> {
    const row = await this.prismaContext.client.offer.findFirst({
      where: { id: id.value, deletedAt: null },
    });
    return row ? OfferPrismaMapper.toDomain(row) : null;
  }

  async updateIfDraft(offer: Offer): Promise<boolean> {
    const data = OfferPrismaMapper.toPersistence(offer);
    const result = await this.prismaContext.client.offer.updateMany({
      where: { id: data.id, status: OfferStatus.Draft },
      data: {
        type: data.type,
        title: data.title,
        description: data.description,
        discountType: data.discountType,
        discountValue: data.discountValue,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        updatedAt: data.updatedAt,
      },
    });
    return result.count > 0;
  }

  async publishIfDraft(offer: Offer): Promise<boolean> {
    const data = OfferPrismaMapper.toPersistence(offer);
    const result = await this.prismaContext.client.offer.updateMany({
      where: { id: data.id, status: OfferStatus.Draft },
      data: { status: OfferStatus.Published, updatedAt: data.updatedAt },
    });
    return result.count > 0;
  }

  async expireIfPublished(id: OfferId, at: Date): Promise<boolean> {
    const result = await this.prismaContext.client.offer.updateMany({
      where: { id: id.value, status: OfferStatus.Published, deletedAt: null },
      data: { status: OfferStatus.Expired, updatedAt: at },
    });
    return result.count > 0;
  }

  async softDelete(id: OfferId, at: Date): Promise<void> {
    await this.prismaContext.client.offer.updateMany({
      where: { id: id.value, deletedAt: null },
      data: { deletedAt: at, updatedAt: at },
    });
  }

  async findManyByRestaurantId(
    restaurantId: RestaurantId,
    page: number,
    limit: number,
  ): Promise<OfferListPage> {
    const where = { restaurantId: restaurantId.value, deletedAt: null };
    const [rows, total] = await Promise.all([
      this.prismaContext.client.offer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaContext.client.offer.count({ where }),
    ]);
    return { items: rows.map(OfferPrismaMapper.toDomain), total };
  }

  async findManyPublicByRestaurantId(
    restaurantId: RestaurantId,
    now: Date,
    page: number,
    limit: number,
  ): Promise<OfferListPage> {
    const where = {
      restaurantId: restaurantId.value,
      status: OfferStatus.Published,
      startsAt: { lte: now },
      endsAt: { gt: now },
      deletedAt: null,
    };
    const [rows, total] = await Promise.all([
      this.prismaContext.client.offer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaContext.client.offer.count({ where }),
    ]);
    return { items: rows.map(OfferPrismaMapper.toDomain), total };
  }

  async findRestaurantIdsWithActivePublicOffer(
    restaurantIds: RestaurantId[],
    now: Date,
  ): Promise<Set<string>> {
    if (restaurantIds.length === 0) {
      return new Set();
    }
    const rows = await this.prismaContext.client.offer.findMany({
      where: {
        restaurantId: { in: restaurantIds.map((id) => id.value) },
        status: OfferStatus.Published,
        startsAt: { lte: now },
        endsAt: { gt: now },
        deletedAt: null,
      },
      select: { restaurantId: true },
      distinct: ['restaurantId'],
    });
    return new Set(rows.map((row) => row.restaurantId));
  }
}
