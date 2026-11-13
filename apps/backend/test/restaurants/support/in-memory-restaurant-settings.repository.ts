import { RestaurantSettings } from '@modules/restaurants/domain/entities/restaurant-settings.entity';
import { RestaurantSettingsRepository } from '@modules/restaurants/domain/repositories/restaurant-settings.repository';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';

export class InMemoryRestaurantSettingsRepository implements RestaurantSettingsRepository {
  private readonly rows = new Map<string, RestaurantSettings>();
  readonly branchRows = new Map<string, RestaurantSettings>();

  async findByRestaurantId(restaurantId: RestaurantId): Promise<RestaurantSettings | null> {
    return this.rows.get(restaurantId.value) ?? null;
  }

  async save(settings: RestaurantSettings): Promise<void> {
    this.rows.set(settings.restaurantId.value, settings);
  }

  async findForBranch(
    restaurantId: RestaurantId,
    branchId: BranchId,
  ): Promise<RestaurantSettings | null> {
    return this.branchRows.get(branchId.value) ?? this.rows.get(restaurantId.value) ?? null;
  }

  async saveForBranch(branchId: BranchId, settings: RestaurantSettings): Promise<void> {
    this.branchRows.set(branchId.value, settings);
  }
}
