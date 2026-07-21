import { CuisineCategoryResult } from './cuisine-category.result';

export interface RestaurantCuisineCategoriesResult {
  restaurantId: string;
  categories: CuisineCategoryResult[];
}
