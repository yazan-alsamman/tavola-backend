import { Entity } from '@shared/domain/base/entity.base';

export interface FavoriteRestaurantProps {
  id: string;
  userId: string;
  restaurantId: string;
  createdAt: Date;
}

/**
 * Child entity of the User aggregate (DOMAIN_MODEL.md: `FavoriteRestaurant`
 * under User's "Child Entities"). Deliberately immutable after creation - a
 * favorite is either created or removed, never edited in place (matches
 * DATABASE_SCHEMA.md's "Favorites" field list, which has no `updatedAt`).
 */
export class FavoriteRestaurant extends Entity<FavoriteRestaurantProps> {
  private constructor(props: FavoriteRestaurantProps) {
    super(props);
  }

  static create(props: FavoriteRestaurantProps): FavoriteRestaurant {
    if (props.userId.trim().length === 0) {
      throw new Error('FavoriteRestaurant must have a userId.');
    }
    if (props.restaurantId.trim().length === 0) {
      throw new Error('FavoriteRestaurant must have a restaurantId.');
    }
    return new FavoriteRestaurant({ ...props });
  }

  static reconstitute(props: FavoriteRestaurantProps): FavoriteRestaurant {
    return new FavoriteRestaurant({ ...props });
  }

  get userId(): string {
    return this.props.userId;
  }

  get restaurantId(): string {
    return this.props.restaurantId;
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }

  toProps(): Readonly<FavoriteRestaurantProps> {
    return { ...this.props };
  }
}
