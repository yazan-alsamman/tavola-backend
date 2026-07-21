import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { RestaurantGalleryImage } from '../../domain/entities/restaurant-gallery-image.entity';
import { RestaurantGalleryRepository } from '../../domain/repositories/restaurant-gallery.repository';
import { RestaurantGalleryPrismaMapper } from './restaurant-gallery.prisma-mapper';

/**
 * `RestaurantGallery` is NOT in `withTenantScoping`'s
 * `DIRECT_TENANT_OWNED_MODELS` (no direct `organizationId` column), so
 * queries here run through the tenant-scoped `PrismaContext` client as a
 * verified no-op passthrough - exactly like `PrismaRestaurantSettingsRepository`/
 * `PrismaWorkingHoursRepository`. This repository provides NO tenant
 * isolation by itself. Every consuming use case MUST resolve the parent
 * `Restaurant` via `RestaurantRepository` (which IS directly tenant-scoped)
 * first, and only call these methods after that succeeds.
 */
@Injectable()
export class PrismaRestaurantGalleryRepository implements RestaurantGalleryRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findAllByRestaurantId(restaurantId: RestaurantId): Promise<RestaurantGalleryImage[]> {
    const rows = await this.prismaContext.client.restaurantGallery.findMany({
      where: { restaurantId: restaurantId.value },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((row) => RestaurantGalleryPrismaMapper.toDomain(row));
  }

  async findById(id: string, restaurantId: RestaurantId): Promise<RestaurantGalleryImage | null> {
    const row = await this.prismaContext.client.restaurantGallery.findFirst({
      where: { id, restaurantId: restaurantId.value },
    });
    return row ? RestaurantGalleryPrismaMapper.toDomain(row) : null;
  }

  async add(image: RestaurantGalleryImage): Promise<void> {
    const data = RestaurantGalleryPrismaMapper.toPersistence(image);
    await this.prismaContext.client.restaurantGallery.create({ data });
  }

  async remove(id: string): Promise<void> {
    await this.prismaContext.client.restaurantGallery.deleteMany({ where: { id } });
  }
}
