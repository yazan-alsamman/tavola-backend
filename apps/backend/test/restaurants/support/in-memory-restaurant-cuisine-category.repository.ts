import { RestaurantCuisineCategory } from '@modules/restaurants/domain/entities/restaurant-cuisine-category.entity';
import { RestaurantCuisineCategoryRepository } from '@modules/restaurants/domain/repositories/restaurant-cuisine-category.repository';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';

export class InMemoryRestaurantCuisineCategoryRepository implements RestaurantCuisineCategoryRepository {
  private readonly rowsByRestaurantId = new Map<string, RestaurantCuisineCategory[]>();

  async findAllByRestaurantId(restaurantId: RestaurantId): Promise<RestaurantCuisineCategory[]> {
    return [...(this.rowsByRestaurantId.get(restaurantId.value) ?? [])];
  }

  async replaceAllForRestaurant(
    restaurantId: RestaurantId,
    entries: RestaurantCuisineCategory[],
  ): Promise<void> {
    this.rowsByRestaurantId.set(restaurantId.value, [...entries]);
  }
}
