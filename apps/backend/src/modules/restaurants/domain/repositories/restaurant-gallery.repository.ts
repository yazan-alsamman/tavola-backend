import { RestaurantGalleryImage } from '../entities/restaurant-gallery-image.entity';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';

/**
 * No `organizationId` parameter, same reasoning as
 * `RestaurantSettingsRepository`/`WorkingHoursRepository`: `RestaurantGallery`
 * is NOT in `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS` (it carries no
 * direct `organizationId` column). Tenant isolation is the CALLER's
 * responsibility: every use case must resolve the parent `Restaurant` via the
 * already-tenant-scoped `RestaurantRepository` first, and only call this
 * repository's methods after that succeeds.
 *
 * `findById` is additionally scoped by `restaurantId` (not just the gallery
 * item's own id) - IDOR defense-in-depth for the `DELETE :id/gallery/:galleryItemId`
 * route: a gallery item that belongs to a *different* restaurant than the one
 * named in the URL must resolve to null, never leak or be deletable through
 * the wrong parent path.
 */
export interface RestaurantGalleryRepository {
  /**
   * ADR-051: a branch's photos when `branchId` is given; otherwise the photos
   * of the restaurant's oldest live branch (rows with no branch when it has
   * none), which is what older clients that name no branch see.
   */
  findAllByRestaurantId(
    restaurantId: RestaurantId,
    branchId?: string,
  ): Promise<RestaurantGalleryImage[]>;
  /** The restaurant's oldest live branch, or null when it has none. */
  findFirstLiveBranchId(restaurantId: RestaurantId): Promise<string | null>;
  /** True when `branchId` is a live branch of `restaurantId`. */
  isLiveBranchOf(restaurantId: RestaurantId, branchId: string): Promise<boolean>;
  /** How many gallery rows still point at a stored file (copies share files, ADR-051). */
  countByFileId(fileId: string): Promise<number>;
  findById(id: string, restaurantId: RestaurantId): Promise<RestaurantGalleryImage | null>;
  add(image: RestaurantGalleryImage): Promise<void>;
  remove(id: string): Promise<void>;
  /** Persists `sortOrder`/`updatedAt` of each image (ADR-046 drag ordering). */
  updateSortOrders(images: RestaurantGalleryImage[]): Promise<void>;
}

export const RESTAURANT_GALLERY_REPOSITORY = Symbol('RESTAURANT_GALLERY_REPOSITORY');
