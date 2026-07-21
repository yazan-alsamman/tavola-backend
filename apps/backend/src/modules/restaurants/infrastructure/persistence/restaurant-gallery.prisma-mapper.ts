import { RestaurantGallery as PrismaRestaurantGalleryImage } from '@prisma/client';
import { RestaurantGalleryImage as RestaurantGalleryImageEntity } from '../../domain/entities/restaurant-gallery-image.entity';

export class RestaurantGalleryPrismaMapper {
  static toDomain(row: PrismaRestaurantGalleryImage): RestaurantGalleryImageEntity {
    return RestaurantGalleryImageEntity.reconstitute({
      id: row.id,
      restaurantId: row.restaurantId,
      fileId: row.fileId,
      caption: row.caption,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  static toPersistence(image: RestaurantGalleryImageEntity): PrismaRestaurantGalleryImage {
    const props = image.toProps();
    return {
      id: props.id,
      restaurantId: props.restaurantId,
      fileId: props.fileId,
      caption: props.caption,
      sortOrder: props.sortOrder,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
    };
  }
}
