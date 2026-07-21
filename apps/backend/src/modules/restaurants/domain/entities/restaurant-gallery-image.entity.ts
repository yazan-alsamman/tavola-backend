import { Entity } from '@shared/domain/base/entity.base';
import { RestaurantId, FileId } from '@shared/domain/value-objects/identifiers.vo';
import { InvalidRestaurantGalleryImageException } from '../exceptions/invalid-restaurant-gallery-image.exception';

export interface RestaurantGalleryImageProps {
  id: string;
  restaurantId: string;
  fileId: string;
  caption: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * One image in a Restaurant's gallery. Restaurant-owned only (approved
 * architecture decision, Phase 4.4) - no Branch ownership. No `updateXxx()`
 * method: images are add/remove only (no caption edit, no reorder endpoint
 * per this phase's approved scope), so this entity is immutable after
 * creation, matching `FavoriteRestaurant`'s own precedent for the same
 * reason.
 */
export class RestaurantGalleryImage extends Entity<RestaurantGalleryImageProps> {
  private constructor(props: RestaurantGalleryImageProps) {
    super(props);
  }

  static create(props: RestaurantGalleryImageProps): RestaurantGalleryImage {
    validate(props);
    return new RestaurantGalleryImage({ ...props });
  }

  static reconstitute(props: RestaurantGalleryImageProps): RestaurantGalleryImage {
    return new RestaurantGalleryImage({ ...props });
  }

  get galleryImageId(): string {
    return this.props.id;
  }

  get restaurantId(): RestaurantId {
    return RestaurantId.create(this.props.restaurantId);
  }

  get fileId(): FileId {
    return FileId.create(this.props.fileId);
  }

  get caption(): string | null {
    return this.props.caption;
  }

  get sortOrder(): number {
    return this.props.sortOrder;
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }

  get updatedAt(): Date {
    return new Date(this.props.updatedAt.getTime());
  }

  toProps(): Readonly<RestaurantGalleryImageProps> {
    return { ...this.props };
  }
}

function validate(props: RestaurantGalleryImageProps): void {
  if (props.restaurantId.trim().length === 0) {
    throw new InvalidRestaurantGalleryImageException('restaurantId must not be empty.');
  }
  if (props.fileId.trim().length === 0) {
    throw new InvalidRestaurantGalleryImageException('fileId must not be empty.');
  }
  if (!Number.isInteger(props.sortOrder) || props.sortOrder < 0) {
    throw new InvalidRestaurantGalleryImageException('sortOrder must be a non-negative integer.');
  }
}
