import { Entity } from '@shared/domain/base/entity.base';

export interface RestaurantOccasionCategoryProps {
  id: string;
  restaurantId: string;
  occasionCategoryId: string;
  createdAt: Date;
}

/**
 * Child entity of the Restaurant aggregate (DATABASE_SCHEMA.md "Restaurant
 * Occasion Categories") - the many-to-many link between a Restaurant and a
 * platform-managed `OccasionCategory`. Deliberately immutable after creation
 * - an assignment is either created or removed, never edited in place
 * (matches DATABASE_SCHEMA.md's field list, which has no `updatedAt`),
 * mirroring `FavoriteRestaurant`'s identical precedent.
 */
export class RestaurantOccasionCategory extends Entity<RestaurantOccasionCategoryProps> {
  private constructor(props: RestaurantOccasionCategoryProps) {
    super(props);
  }

  static create(props: RestaurantOccasionCategoryProps): RestaurantOccasionCategory {
    if (props.restaurantId.trim().length === 0) {
      throw new Error('RestaurantOccasionCategory must have a restaurantId.');
    }
    if (props.occasionCategoryId.trim().length === 0) {
      throw new Error('RestaurantOccasionCategory must have a occasionCategoryId.');
    }
    return new RestaurantOccasionCategory({ ...props });
  }

  static reconstitute(props: RestaurantOccasionCategoryProps): RestaurantOccasionCategory {
    return new RestaurantOccasionCategory({ ...props });
  }

  get restaurantId(): string {
    return this.props.restaurantId;
  }

  get occasionCategoryId(): string {
    return this.props.occasionCategoryId;
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }

  toProps(): Readonly<RestaurantOccasionCategoryProps> {
    return { ...this.props };
  }
}
