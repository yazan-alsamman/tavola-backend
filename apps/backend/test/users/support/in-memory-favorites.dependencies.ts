import { UserId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { FavoriteRestaurant } from '@modules/users/domain/entities/favorite-restaurant.entity';
import {
  FavoriteRestaurantPage,
  FavoriteRestaurantRepository,
} from '@modules/users/domain/repositories/favorite-restaurant.repository';
import {
  RestaurantDirectoryReaderPort,
  RestaurantSummary,
} from '@modules/users/application/ports/restaurant-directory-reader.port';

/**
 * Mirrors the real `PrismaFavoriteRestaurantRepository`'s concurrency
 * contract: `add()` never throws on a duplicate `(userId, restaurantId)`
 * pair, returning the already-existing row instead - the same idempotent
 * behavior the real repository gets from the database's unique constraint.
 */
export class InMemoryFavoriteRestaurantRepository implements FavoriteRestaurantRepository {
  private readonly favorites: FavoriteRestaurant[] = [];

  async add(favorite: FavoriteRestaurant): Promise<FavoriteRestaurant> {
    const existing = this.favorites.find(
      (entry) => entry.userId === favorite.userId && entry.restaurantId === favorite.restaurantId,
    );
    if (existing) {
      return existing;
    }
    this.favorites.push(favorite);
    return favorite;
  }

  async remove(userId: UserId, restaurantId: RestaurantId): Promise<void> {
    const index = this.favorites.findIndex(
      (entry) => entry.userId === userId.value && entry.restaurantId === restaurantId.value,
    );
    if (index >= 0) {
      this.favorites.splice(index, 1);
    }
  }

  async findByUserAndRestaurant(
    userId: UserId,
    restaurantId: RestaurantId,
  ): Promise<FavoriteRestaurant | null> {
    return (
      this.favorites.find(
        (entry) => entry.userId === userId.value && entry.restaurantId === restaurantId.value,
      ) ?? null
    );
  }

  async listByUser(userId: UserId, page: number, limit: number): Promise<FavoriteRestaurantPage> {
    const all = this.favorites
      .filter((entry) => entry.userId === userId.value)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (page - 1) * limit;
    return {
      items: all.slice(start, start + limit),
      total: all.length,
    };
  }

  async deleteAllByUserId(userId: UserId): Promise<void> {
    for (let i = this.favorites.length - 1; i >= 0; i -= 1) {
      if (this.favorites[i].userId === userId.value) {
        this.favorites.splice(i, 1);
      }
    }
  }

  seed(favorite: FavoriteRestaurant): void {
    this.favorites.push(favorite);
  }

  snapshot(): FavoriteRestaurant[] {
    return [...this.favorites];
  }
}

export class InMemoryRestaurantDirectoryReader implements RestaurantDirectoryReaderPort {
  private readonly restaurants = new Map<string, RestaurantSummary>();

  async findById(restaurantId: string): Promise<RestaurantSummary | null> {
    return this.restaurants.get(restaurantId) ?? null;
  }

  async findManyByIds(restaurantIds: string[]): Promise<RestaurantSummary[]> {
    return restaurantIds.flatMap((id) => {
      const summary = this.restaurants.get(id);
      return summary ? [summary] : [];
    });
  }

  seed(summary: RestaurantSummary): void {
    this.restaurants.set(summary.id, summary);
  }

  remove(restaurantId: string): void {
    this.restaurants.delete(restaurantId);
  }
}
