import { RestaurantUsage } from '@modules/restaurants/domain/entities/restaurant-usage.entity';
import { RestaurantUsageRepository } from '@modules/restaurants/domain/repositories/restaurant-usage.repository';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';

export class InMemoryRestaurantUsageRepository implements RestaurantUsageRepository {
  private readonly rows = new Map<string, RestaurantUsage>();

  async findByRestaurantId(restaurantId: RestaurantId): Promise<RestaurantUsage | null> {
    return this.rows.get(restaurantId.value) ?? null;
  }

  async findManyByRestaurantIds(restaurantIds: RestaurantId[]): Promise<RestaurantUsage[]> {
    return restaurantIds
      .map((id) => this.rows.get(id.value))
      .filter((row): row is RestaurantUsage => row !== undefined);
  }

  async create(usage: RestaurantUsage): Promise<void> {
    this.rows.set(usage.restaurantId.value, usage);
  }

  async incrementBranchCountIfUnderLimit(
    restaurantId: RestaurantId,
    limit: number,
  ): Promise<boolean> {
    const existing = this.rows.get(restaurantId.value);
    if (!existing || existing.branchCount >= limit) {
      return false;
    }
    this.rows.set(
      restaurantId.value,
      RestaurantUsage.reconstitute({
        ...existing.toProps(),
        branchCount: existing.branchCount + 1,
        updatedAt: new Date(),
      }),
    );
    return true;
  }

  async incrementEmployeeCountIfUnderLimit(
    restaurantId: RestaurantId,
    limit: number,
  ): Promise<boolean> {
    const existing = this.rows.get(restaurantId.value);
    if (!existing || existing.employeeCount >= limit) {
      return false;
    }
    this.rows.set(
      restaurantId.value,
      RestaurantUsage.reconstitute({
        ...existing.toProps(),
        employeeCount: existing.employeeCount + 1,
        updatedAt: new Date(),
      }),
    );
    return true;
  }

  async decrementBranchCount(restaurantId: RestaurantId): Promise<void> {
    const existing = this.rows.get(restaurantId.value);
    if (!existing || existing.branchCount <= 0) {
      return;
    }
    this.rows.set(
      restaurantId.value,
      RestaurantUsage.reconstitute({
        ...existing.toProps(),
        branchCount: existing.branchCount - 1,
        updatedAt: new Date(),
      }),
    );
  }

  async decrementEmployeeCount(restaurantId: RestaurantId): Promise<void> {
    const existing = this.rows.get(restaurantId.value);
    if (!existing || existing.employeeCount <= 0) {
      return;
    }
    this.rows.set(
      restaurantId.value,
      RestaurantUsage.reconstitute({
        ...existing.toProps(),
        employeeCount: existing.employeeCount - 1,
        updatedAt: new Date(),
      }),
    );
  }
}
