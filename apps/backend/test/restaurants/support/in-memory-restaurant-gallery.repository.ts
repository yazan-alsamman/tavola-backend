import { RestaurantGalleryImage } from '@modules/restaurants/domain/entities/restaurant-gallery-image.entity';
import { RestaurantGalleryRepository } from '@modules/restaurants/domain/repositories/restaurant-gallery.repository';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';

export class InMemoryRestaurantGalleryRepository implements RestaurantGalleryRepository {
  private readonly rows = new Map<string, RestaurantGalleryImage>();
  /** restaurantId -> live branch ids, oldest first. */
  readonly branchesByRestaurant = new Map<string, string[]>();

  async findAllByRestaurantId(
    restaurantId: RestaurantId,
    branchId?: string,
  ): Promise<RestaurantGalleryImage[]> {
    const resolved = branchId ?? this.branchesByRestaurant.get(restaurantId.value)?.[0] ?? null;
    return [...this.rows.values()].filter(
      (image) => image.restaurantId.value === restaurantId.value && image.branchId === resolved,
    );
  }

  async findFirstLiveBranchId(restaurantId: RestaurantId): Promise<string | null> {
    return this.branchesByRestaurant.get(restaurantId.value)?.[0] ?? null;
  }

  async isLiveBranchOf(restaurantId: RestaurantId, branchId: string): Promise<boolean> {
    return this.branchesByRestaurant.get(restaurantId.value)?.includes(branchId) ?? false;
  }

  async countByFileId(fileId: string): Promise<number> {
    return [...this.rows.values()].filter((image) => image.fileId.value === fileId).length;
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

  async updateSortOrders(images: RestaurantGalleryImage[]): Promise<void> {
    for (const image of images) {
      this.rows.set(image.galleryImageId, image);
    }
  }
}
