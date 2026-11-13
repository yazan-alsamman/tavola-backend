import { BranchWorkingHours } from '@modules/branches/domain/entities/branch-working-hours.entity';
import { BranchWorkingHoursRepository } from '@modules/branches/domain/repositories/branch-working-hours.repository';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';

export class InMemoryBranchWorkingHoursRepository implements BranchWorkingHoursRepository {
  private readonly rows = new Map<string, BranchWorkingHours[]>();
  /** restaurantId -> branch ids, oldest first. */
  private readonly branchesByRestaurant = new Map<string, string[]>();

  /** Records a branch of a restaurant; call in creation order. */
  registerBranch(restaurantId: string, branchId: string): void {
    const list = this.branchesByRestaurant.get(restaurantId) ?? [];
    list.push(branchId);
    this.branchesByRestaurant.set(restaurantId, list);
  }

  async findAllByBranchId(branchId: BranchId): Promise<BranchWorkingHours[]> {
    return this.rows.get(branchId.value) ?? [];
  }

  async findAllByBranchIds(branchIds: BranchId[]): Promise<BranchWorkingHours[]> {
    return branchIds.flatMap((id) => this.rows.get(id.value) ?? []);
  }

  async findForFirstBranchOfRestaurants(
    restaurantIds: RestaurantId[],
  ): Promise<Map<string, BranchWorkingHours[]>> {
    const result = new Map<string, BranchWorkingHours[]>();
    for (const restaurantId of restaurantIds) {
      const first = this.branchesByRestaurant.get(restaurantId.value)?.[0];
      if (first !== undefined) {
        result.set(restaurantId.value, this.rows.get(first) ?? []);
      }
    }
    return result;
  }

  async replaceAllForBranch(branchId: BranchId, entries: BranchWorkingHours[]): Promise<void> {
    this.rows.set(branchId.value, entries);
  }
}
