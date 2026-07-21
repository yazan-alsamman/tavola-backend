import { OccasionCategoryResult } from './occasion-category.result';

export interface RestaurantOccasionCategoriesResult {
  restaurantId: string;
  categories: OccasionCategoryResult[];
}
