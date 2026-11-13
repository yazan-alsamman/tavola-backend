import { Entity } from '@shared/domain/base/entity.base';
import { RestaurantId, FileId } from '@shared/domain/value-objects/identifiers.vo';
import { InvalidRestaurantGalleryImageException } from '../exceptions/invalid-restaurant-gallery-image.exception';

export interface RestaurantGalleryImageProps {
  id: string;
  restaurantId: string;
  /** ADR-051: the branch this photo belongs to; null only on a restaurant with no branch. */
  branchId: string | null;
  fileId: string;
  caption: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * One image in a branch's gallery (ADR-051; Phase 4.4 made it restaurant-owned). Images are
 * added and removed; the only change after creation is the position
 * (`moveTo`, drag ordering - ADR-046).
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

  get branchId(): string | null {
    return this.props.branchId;
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

  moveTo(sortOrder: number, at: Date): RestaurantGalleryImage {
    return RestaurantGalleryImage.create({ ...this.props, sortOrder, updatedAt: at });
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
