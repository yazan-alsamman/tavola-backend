export interface RestaurantGalleryImageResult {
  galleryItemId: string;
  restaurantId: string;
  branchId: string | null;
  caption: string | null;
  sortOrder: number;
  imageUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RestaurantGalleryListResult {
  restaurantId: string;
  items: RestaurantGalleryImageResult[];
}
