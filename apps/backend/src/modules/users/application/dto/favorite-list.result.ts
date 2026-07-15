export interface FavoriteListItemResult {
  restaurantId: string;
  name: string;
  slug: string;
  cuisineType: string | null;
  priceLevel: number | null;
  averageRating: number | null;
  status: string;
  favoritedAt: Date;
}

export interface FavoriteListResult {
  items: FavoriteListItemResult[];
  page: number;
  limit: number;
  total: number;
}
