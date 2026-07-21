import { RestaurantOccasionCategory } from '@modules/restaurants/domain/entities/restaurant-occasion-category.entity';
import { RestaurantOccasionCategoryRepository } from '@modules/restaurants/domain/repositories/restaurant-occasion-category.repository';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';

export class InMemoryRestaurantOccasionCategoryRepository implements RestaurantOccasionCategoryRepository {
  private readonly rowsByRestaurantId = new Map<string, RestaurantOccasionCategory[]>();

  async findAllByRestaurantId(restaurantId: RestaurantId): Promise<RestaurantOccasionCategory[]> {
    return [...(this.rowsByRestaurantId.get(restaurantId.value) ?? [])];
  }

  async replaceAllForRestaurant(
    restaurantId: RestaurantId,
    entries: RestaurantOccasionCategory[],
  ): Promise<void> {
    this.rowsByRestaurantId.set(restaurantId.value, [...entries]);
  }
}
