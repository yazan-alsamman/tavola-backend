import { Entity } from '@shared/domain/base/entity.base';

export interface SubscriptionUsageProps {
  id: string;
  organizationId: string;
  restaurantCount: number;
  updatedAt: Date;
}

/**
 * Organization-scoped usage counter (Phase 12, ADR-027) - tracks only what
 * `maxRestaurants` needs to enforce. Deliberately does not carry
 * `branchCount`/`employeeCount` - see `RestaurantUsage` (Restaurant
 * Aggregate) for why those two are Restaurant-scoped instead.
 *
 * Plain read/reconstitution model - actual counter mutation is an atomic
 * conditional `UPDATE` in `SubscriptionUsageRepository`, never a
 * read-modify-write through this entity (D15).
 */
export class SubscriptionUsage extends Entity<SubscriptionUsageProps> {
  private constructor(props: SubscriptionUsageProps) {
    super(props);
  }

  static create(props: { id: string; organizationId: string; now: Date }): SubscriptionUsage {
    return new SubscriptionUsage({
      id: props.id,
      organizationId: props.organizationId,
      restaurantCount: 0,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: SubscriptionUsageProps): SubscriptionUsage {
    return new SubscriptionUsage({ ...props });
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get restaurantCount(): number {
    return this.props.restaurantCount;
  }

  toProps(): Readonly<SubscriptionUsageProps> {
    return { ...this.props };
  }
}
