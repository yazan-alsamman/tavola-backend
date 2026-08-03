import { RestaurantUsage } from '../entities/restaurant-usage.entity';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';

/**
 * Transitively tenant-owned via `restaurantId -> Restaurant.organizationId`
 * (TENANCY.md, ADR-027 §12) - NOT in `withTenantScoping`'s
 * `DIRECT_TENANT_OWNED_MODELS`, same pattern as `RestaurantSettingsRepository`.
 * Callers must resolve the parent Restaurant via the already-tenant-scoped
 * `RestaurantRepository` first.
 */
export interface RestaurantUsageRepository {
  findByRestaurantId(restaurantId: RestaurantId): Promise<RestaurantUsage | null>;

  /** Every RestaurantUsage row for a set of Restaurants (downgrade validation, D13 - scans every Restaurant in the Organization). */
  findManyByRestaurantIds(restaurantIds: RestaurantId[]): Promise<RestaurantUsage[]>;

  create(usage: RestaurantUsage): Promise<void>;

  /**
   * D15's atomic conditional increment -
   * `UPDATE restaurant_usage SET branch_count = branch_count + 1
   * WHERE restaurant_id = ? AND branch_count < ?`. Returns `false` if
   * already at the limit. Must be called inside the same `UnitOfWorkPort`
   * transaction as the Branch insert.
   */
  incrementBranchCountIfUnderLimit(restaurantId: RestaurantId, limit: number): Promise<boolean>;

  /** Same shape as above, for `employeeCount`/`maxEmployeesPerRestaurant`. */
  incrementEmployeeCountIfUnderLimit(restaurantId: RestaurantId, limit: number): Promise<boolean>;

  /** Branch soft-delete decrement (`DeleteBranchUseCase`) - never below zero. */
  decrementBranchCount(restaurantId: RestaurantId): Promise<void>;

  /** Employee soft-delete decrement (`RemoveEmployeeUseCase`) - never below zero. */
  decrementEmployeeCount(restaurantId: RestaurantId): Promise<void>;
}

export const RESTAURANT_USAGE_REPOSITORY = Symbol('RESTAURANT_USAGE_REPOSITORY');
