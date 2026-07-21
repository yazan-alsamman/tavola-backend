import { Injectable, Inject } from '@nestjs/common';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  FileRepository,
  FILE_REPOSITORY,
} from '@modules/files/domain/repositories/file.repository';
import { StoragePort, STORAGE_PORT } from '@modules/files/application/ports/storage.port';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '../../domain/repositories/restaurant.repository';
import {
  RestaurantGalleryRepository,
  RESTAURANT_GALLERY_REPOSITORY,
} from '../../domain/repositories/restaurant-gallery.repository';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { RestaurantGalleryImage } from '../../domain/entities/restaurant-gallery-image.entity';
import { toRestaurantGalleryImageResult } from '../mappers/restaurant-gallery-image-result.mapper';
import { ListRestaurantGalleryCommand } from '../dto/list-restaurant-gallery.command';
import { RestaurantGalleryListResult } from '../dto/restaurant-gallery-image.result';

@Injectable()
export class ListRestaurantGalleryUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(RESTAURANT_GALLERY_REPOSITORY)
    private readonly galleryRepository: RestaurantGalleryRepository,
    @Inject(FILE_REPOSITORY) private readonly fileRepository: FileRepository,
    @Inject(STORAGE_PORT) private readonly storagePort: StoragePort,
  ) {}

  async execute(command: ListRestaurantGalleryCommand): Promise<RestaurantGalleryListResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);

    // Tenant isolation gate - see AddRestaurantGalleryImageUseCase's own comment.
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const images = await this.galleryRepository.findAllByRestaurantId(restaurantId);
    const sorted = [...images].sort((a, b) => a.sortOrder - b.sortOrder);

    // Bounded, disclosed N+1: at most GALLERY_MAX_IMAGES_PER_RESTAURANT (20)
    // FileRepository lookups per list call - a signed URL requires the
    // parent File's bucket/objectKey, which RestaurantGallery deliberately
    // does not denormalize (DATABASE_SCHEMA.md's documented field list has
    // no bucket/objectKey columns; the Files aggregate remains the sole
    // owner of that data). Not batched (FileRepository has no findByIds) -
    // adding one would be Files-module scope expansion beyond "reuse
    // completely" for a call capped at 20 rows.
    const items = await Promise.all(sorted.map((image) => this.toResultWithSignedUrl(image)));

    return { restaurantId: restaurantId.value, items };
  }

  private async toResultWithSignedUrl(image: RestaurantGalleryImage) {
    const file = await this.fileRepository.findById(image.fileId);
    const imageUrl = file
      ? await this.storagePort.getSignedReadUrl(file.bucket, file.objectKey)
      : null;
    return toRestaurantGalleryImageResult(image, imageUrl);
  }
}
