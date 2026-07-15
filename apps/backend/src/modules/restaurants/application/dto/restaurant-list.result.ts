import { RestaurantResult } from './restaurant.result';

export interface RestaurantListResult {
  items: RestaurantResult[];
  page: number;
  limit: number;
  total: number;
}
