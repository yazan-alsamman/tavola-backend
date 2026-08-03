import { Entity } from '@shared/domain/base/entity.base';
import { SubscriptionPlanId } from '@shared/domain/value-objects/identifiers.vo';
import { InvalidSubscriptionStatusTransitionException } from '../exceptions/invalid-subscription-status-transition.exception';

export interface SubscriptionPlanProps {
  id: string;
  name: string;
  slug: string;
  maxRestaurants: number;
  maxBranchesPerRestaurant: number;
  maxEmployeesPerRestaurant: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Platform-global reference data (TENANCY.md, ADR-027) - not tenant-owned,
 * seed-managed only (no runtime write API in Phase 12, D2). Generic
 * architecture - no commercial tier name is frozen by the domain model
 * itself.
 *
 * Plan Immutability (ADR-027 §10, D34): once any live `Subscription`
 * references a plan, its limit fields must never be edited in place - a
 * limit change means seeding a new plan and moving affected subscriptions
 * via the normal plan-change path. This entity does not expose any
 * limit-mutating method at all (by design - there is nothing to call), only
 * `archive()`, which excludes a plan from *new* assignment without
 * affecting existing subscribers.
 */
export class SubscriptionPlan extends Entity<SubscriptionPlanProps> {
  private constructor(props: SubscriptionPlanProps) {
    super(props);
  }

  static create(props: {
    id: string;
    name: string;
    slug: string;
    maxRestaurants: number;
    maxBranchesPerRestaurant: number;
    maxEmployeesPerRestaurant: number;
    now: Date;
  }): SubscriptionPlan {
    validateLimits({
      maxRestaurants: props.maxRestaurants,
      maxBranchesPerRestaurant: props.maxBranchesPerRestaurant,
      maxEmployeesPerRestaurant: props.maxEmployeesPerRestaurant,
    });
    return new SubscriptionPlan({
      id: props.id,
      name: props.name,
      slug: props.slug,
      maxRestaurants: props.maxRestaurants,
      maxBranchesPerRestaurant: props.maxBranchesPerRestaurant,
      maxEmployeesPerRestaurant: props.maxEmployeesPerRestaurant,
      archivedAt: null,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: SubscriptionPlanProps): SubscriptionPlan {
    return new SubscriptionPlan({ ...props });
  }

  get planId(): SubscriptionPlanId {
    return SubscriptionPlanId.create(this.props.id);
  }

  get name(): string {
    return this.props.name;
  }

  get slug(): string {
    return this.props.slug;
  }

  get maxRestaurants(): number {
    return this.props.maxRestaurants;
  }

  get maxBranchesPerRestaurant(): number {
    return this.props.maxBranchesPerRestaurant;
  }

  get maxEmployeesPerRestaurant(): number {
    return this.props.maxEmployeesPerRestaurant;
  }

  get archivedAt(): Date | null {
    return this.props.archivedAt ? new Date(this.props.archivedAt.getTime()) : null;
  }

  isArchived(): boolean {
    return this.props.archivedAt !== null;
  }

  /** Excludes this plan from new assignment. Existing subscribers are unaffected (ADR-027 §10). */
  archive(at: Date): SubscriptionPlan {
    if (this.props.archivedAt !== null) {
      throw new InvalidSubscriptionStatusTransitionException('Plan is already archived.');
    }
    return SubscriptionPlan.reconstitute({
      ...this.props,
      archivedAt: at,
      updatedAt: at,
    });
  }

  toProps(): Readonly<SubscriptionPlanProps> {
    return { ...this.props };
  }
}

function validateLimits(props: {
  maxRestaurants: number;
  maxBranchesPerRestaurant: number;
  maxEmployeesPerRestaurant: number;
}): void {
  for (const [key, value] of Object.entries(props)) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${key} must be a nonnegative integer.`);
    }
  }
}
