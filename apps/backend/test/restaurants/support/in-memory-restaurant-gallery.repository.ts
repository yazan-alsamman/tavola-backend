import { RestaurantGalleryImage } from '@modules/restaurants/domain/entities/restaurant-gallery-image.entity';
import { RestaurantGalleryRepository } from '@modules/restaurants/domain/repositories/restaurant-gallery.repository';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';

export class InMemoryRestaurantGalleryRepository implements RestaurantGalleryRepository {
  private readonly rows = new Map<string, RestaurantGalleryImage>();

  async findAllByRestaurantId(restaurantId: RestaurantId): Promise<RestaurantGalleryImage[]> {
    return [...this.rows.values()].filter(
      (image) => image.restaurantId.value === restaurantId.value,
    );
  }

  async findById(id: string, restaurantId: RestaurantId): Promise<RestaurantGalleryImage | null> {
    const image = this.rows.get(id);
    if (!image || image.restaurantId.value !== restaurantId.value) {
      return null;
    }
    return image;
  }

  async add(image: RestaurantGalleryImage): Promise<void> {
    this.rows.set(image.galleryImageId, image);
  }

  async remove(id: string): Promise<void> {
    this.rows.delete(id);
  }
}
