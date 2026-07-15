import { UserId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { FavoriteRestaurant } from '../entities/favorite-restaurant.entity';

export interface FavoriteRestaurantPage {
  items: FavoriteRestaurant[];
  total: number;
}

export interface FavoriteRestaurantRepository {
  /**
   * Idempotent by design: a concurrent duplicate add must never surface as
   * an error. Implementations rely on the database's own
   * `unique(userId, restaurantId)` constraint as the final concurrency
   * invariant (never a prior `exists()` check alone), returning the
   * already-existing row on a unique-violation race instead of throwing.
   */
  add(favorite: FavoriteRestaurant): Promise<FavoriteRestaurant>;

  /** Idempotent: removing a favorite that does not exist is a silent no-op. */
  remove(userId: UserId, restaurantId: RestaurantId): Promise<void>;

  findByUserAndRestaurant(
    userId: UserId,
    restaurantId: RestaurantId,
  ): Promise<FavoriteRestaurant | null>;

  listByUser(userId: UserId, page: number, limit: number): Promise<FavoriteRestaurantPage>;
}

export const FAVORITE_RESTAURANT_REPOSITORY = Symbol('FAVORITE_RESTAURANT_REPOSITORY');
