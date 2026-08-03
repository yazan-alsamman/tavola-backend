import { Entity } from '@shared/domain/base/entity.base';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';

export interface RestaurantUsageProps {
  id: string;
  restaurantId: string;
  branchCount: number;
  employeeCount: number;
  updatedAt: Date;
}

/**
 * Restaurant Aggregate child entity (Phase 12, ADR-027) - the counter-half
 * of `maxBranchesPerRestaurant`/`maxEmployeesPerRestaurant`. Exists because
 * those two limits are PER-RESTAURANT, not Organization-wide: a single
 * Organization-scoped counter cannot tell which specific Restaurant is over
 * its own cap (see DATABASE_SCHEMA.md "Restaurant Usage"). One row per
 * Restaurant, created alongside it (`branchCount = 0`, `employeeCount = 0`).
 *
 * This entity is a plain read/reconstitution model - the actual counter
 * mutations are atomic conditional `UPDATE`s performed directly by
 * `RestaurantUsageRepository` (D15's concurrency-safe increment/decrement),
 * never a read-modify-write through this entity, to avoid the exact TOCTOU
 * race ADR-027 §5 forbids.
 */
export class RestaurantUsage extends Entity<RestaurantUsageProps> {
  private constructor(props: RestaurantUsageProps) {
    super(props);
  }

  static create(props: { id: string; restaurantId: string; now: Date }): RestaurantUsage {
    return new RestaurantUsage({
      id: props.id,
      restaurantId: props.restaurantId,
      branchCount: 0,
      employeeCount: 0,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: RestaurantUsageProps): RestaurantUsage {
    return new RestaurantUsage({ ...props });
  }

  get restaurantId(): RestaurantId {
    return RestaurantId.create(this.props.restaurantId);
  }

  get branchCount(): number {
    return this.props.branchCount;
  }

  get employeeCount(): number {
    return this.props.employeeCount;
  }

  toProps(): Readonly<RestaurantUsageProps> {
    return { ...this.props };
  }
}
