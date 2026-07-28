export interface ListRestaurantReviewsCommand {
  restaurantId: string;
  page: number;
  limit: number;
}
