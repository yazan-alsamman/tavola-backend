import { RestaurantGalleryImage } from '../../domain/entities/restaurant-gallery-image.entity';
import { RestaurantGalleryImageResult } from '../dto/restaurant-gallery-image.result';

export function toRestaurantGalleryImageResult(
  image: RestaurantGalleryImage,
  imageUrl: string | null,
): RestaurantGalleryImageResult {
  return {
    galleryItemId: image.galleryImageId,
    restaurantId: image.restaurantId.value,
    caption: image.caption,
    sortOrder: image.sortOrder,
    imageUrl,
    createdAt: image.createdAt,
    updatedAt: image.updatedAt,
  };
}
