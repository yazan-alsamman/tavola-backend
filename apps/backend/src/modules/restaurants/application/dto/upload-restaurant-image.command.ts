import { UploadedGalleryImageFile } from './add-restaurant-gallery-image.command';

export type RestaurantImageSlot = 'cover' | 'logo';

export interface UploadRestaurantImageCommand {
  actorUserId: string;
  organizationId: string;
  restaurantId: string;
  slot: RestaurantImageSlot;
  /** Cover only (ADR-051): the branch whose cover this is; omitted, the restaurant's own cover. */
  branchId?: string | null;
  file: UploadedGalleryImageFile | null;
  correlationId?: string;
}

export interface UploadRestaurantImageResult {
  slot: RestaurantImageSlot;
  branchId: string | null;
  fileId: string;
  imageUrl: string;
  mimeType: string;
  sizeBytes: number;
}
