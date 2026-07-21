import { Entity } from '@shared/domain/base/entity.base';

export interface RestaurantCuisineCategoryProps {
  id: string;
  restaurantId: string;
  cuisineCategoryId: string;
  createdAt: Date;
}

/**
 * Child entity of the Restaurant aggregate (DATABASE_SCHEMA.md "Restaurant
 * Cuisine Categories") - the many-to-many link between a Restaurant and a
 * platform-managed `CuisineCategory`. Deliberately immutable after creation -
 * an assignment is either created or removed, never edited in place (matches
 * DATABASE_SCHEMA.md's field list, which has no `updatedAt`), mirroring
 * `FavoriteRestaurant`'s identical precedent.
 */
export class RestaurantCuisineCategory extends Entity<RestaurantCuisineCategoryProps> {
  private constructor(props: RestaurantCuisineCategoryProps) {
    super(props);
  }

  static create(props: RestaurantCuisineCategoryProps): RestaurantCuisineCategory {
    if (props.restaurantId.trim().length === 0) {
      throw new Error('RestaurantCuisineCategory must have a restaurantId.');
    }
    if (props.cuisineCategoryId.trim().length === 0) {
      throw new Error('RestaurantCuisineCategory must have a cuisineCategoryId.');
    }
    return new RestaurantCuisineCategory({ ...props });
  }

  static reconstitute(props: RestaurantCuisineCategoryProps): RestaurantCuisineCategory {
    return new RestaurantCuisineCategory({ ...props });
  }

  get restaurantId(): string {
    return this.props.restaurantId;
  }

  get cuisineCategoryId(): string {
    return this.props.cuisineCategoryId;
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }

  toProps(): Readonly<RestaurantCuisineCategoryProps> {
    return { ...this.props };
  }
}
