import { SubscriptionUsage } from '../entities/subscription-usage.entity';

/**
 * Direct tenant-owned (`organizationId`, unique - TENANCY.md, ADR-027 §12).
 * `maxRestaurants` is the only limit this repository enforces - see
 * `RestaurantUsageRepository` (Restaurant Aggregate) for the two
 * per-Restaurant limits.
 */
export interface SubscriptionUsageRepository {
  /** Tenant-scoped, same reasoning as `SubscriptionRepository.findByOrganizationId`. */
  findByOrganizationId(): Promise<SubscriptionUsage | null>;

  create(usage: SubscriptionUsage): Promise<void>;

  /**
   * D15's atomic conditional increment -
   * `UPDATE subscription_usage SET restaurant_count = restaurant_count + 1
   * WHERE organization_id = ? AND restaurant_count < ?`. Returns `false`
   * (no row affected) if already at the limit - the caller must roll back
   * the whole transaction (never create the Restaurant) when this returns
   * `false`. Must be called inside the same `UnitOfWorkPort` transaction as
   * the Restaurant insert.
   */
  incrementRestaurantCountIfUnderLimit(organizationId: string, limit: number): Promise<boolean>;

  /**
   * Restaurant soft-delete decrement (`DeleteRestaurantUseCase`) - a plain
   * conditional decrement, never below zero (`GREATEST(restaurant_count - 1, 0)`),
   * inside the same transaction as the Restaurant's own soft-delete write.
   */
  decrementRestaurantCount(organizationId: string): Promise<void>;
}

export const SUBSCRIPTION_USAGE_REPOSITORY = Symbol('SUBSCRIPTION_USAGE_REPOSITORY');
