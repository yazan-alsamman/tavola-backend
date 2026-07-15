import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import {
  RestaurantListPage,
  RestaurantRepository,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { RestaurantSlug } from '@shared/domain/value-objects/restaurant-slug.vo';

export class InMemoryRestaurantRepository implements RestaurantRepository {
  private readonly rows = new Map<string, Restaurant>();

  async findById(id: RestaurantId): Promise<Restaurant | null> {
    const restaurant = this.rows.get(id.value);
    if (!restaurant || restaurant.isSoftDeleted()) {
      return null;
    }
    return restaurant;
  }

  async existsBySlug(slug: RestaurantSlug): Promise<boolean> {
    for (const restaurant of this.rows.values()) {
      if (restaurant.slug.value === slug.value && !restaurant.isSoftDeleted()) {
        return true;
      }
    }
    return false;
  }

  async findMany(page: number, limit: number): Promise<RestaurantListPage> {
    const active = [...this.rows.values()]
      .filter((restaurant) => !restaurant.isSoftDeleted())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const start = (page - 1) * limit;
    return { items: active.slice(start, start + limit), total: active.length };
  }

  async save(restaurant: Restaurant): Promise<void> {
    this.rows.set(restaurant.restaurantId.value, restaurant);
  }
}
