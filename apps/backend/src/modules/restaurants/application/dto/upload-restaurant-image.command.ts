import { UploadedGalleryImageFile } from './add-restaurant-gallery-image.command';

export type RestaurantImageSlot = 'cover' | 'logo';

export interface UploadRestaurantImageCommand {
  actorUserId: string;
  organizationId: string;
  restaurantId: string;
  slot: RestaurantImageSlot;
  file: UploadedGalleryImageFile | null;
  correlationId?: string;
}

export interface UploadRestaurantImageResult {
  slot: RestaurantImageSlot;
  fileId: string;
  imageUrl: string;
  mimeType: string;
  sizeBytes: number;
}
