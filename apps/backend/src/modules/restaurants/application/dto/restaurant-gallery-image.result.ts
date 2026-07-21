export interface RestaurantGalleryImageResult {
  galleryItemId: string;
  restaurantId: string;
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
