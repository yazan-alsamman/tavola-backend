import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import {
  RestaurantListPage,
  RestaurantRepository,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { RestaurantSlug } from '@shared/domain/value-objects/restaurant-slug.vo';

interface ReviewSourceRow {
  restaurantId: string;
  rating: number;
  deletedAt: Date | null;
}

export class InMemoryRestaurantRepository implements RestaurantRepository {
  private readonly rows = new Map<string, Restaurant>();
  private reviewSource: (() => ReviewSourceRow[]) | null = null;

  /**
   * Test-only wiring (Phase 10, Reviews): lets a spec compute
   * `averageRating` consistently with a companion `InMemoryReviewRepository`,
   * mirroring what the real Prisma implementation computes directly from the
   * `reviews` table in one atomic `UPDATE`. Not part of the `RestaurantRepository`
   * interface - production code never calls this.
   */
  setReviewSource(source: () => ReviewSourceRow[]): void {
    this.reviewSource = source;
  }

  async recomputeAverageRating(id: RestaurantId, at: Date): Promise<void> {
    const restaurant = this.rows.get(id.value);
    if (!restaurant) {
      return;
    }
    const rows = this.reviewSource ? this.reviewSource() : [];
    const active = rows.filter((row) => row.restaurantId === id.value && row.deletedAt === null);
    const averageRating =
      active.length === 0
        ? null
        : Math.round((active.reduce((sum, row) => sum + row.rating, 0) / active.length) * 100) /
          100;
    this.rows.set(
      id.value,
      Restaurant.reconstitute({ ...restaurant.toProps(), averageRating, updatedAt: at }),
    );
  }

  /** No-op: the in-memory fake has no concurrent writers to serialize against. */
  async lockForRatingRecompute(_id: RestaurantId): Promise<void> {
    return Promise.resolve();
  }

  async findById(id: RestaurantId): Promise<Restaurant | null> {
    const restaurant = this.rows.get(id.value);
    if (!restaurant || restaurant.isSoftDeleted()) {
      return null;
    }
    return restaurant;
  }

  async existsPubliclyById(id: RestaurantId): Promise<boolean> {
    const restaurant = this.rows.get(id.value);
    return restaurant !== undefined && !restaurant.isSoftDeleted();
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
