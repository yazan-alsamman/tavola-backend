import { Branch } from '@modules/branches/domain/entities/branch.entity';
import {
  BranchListPage,
  BranchRepository,
} from '@modules/branches/domain/repositories/branch.repository';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';

export class InMemoryBranchRepository implements BranchRepository {
  private readonly rows = new Map<string, Branch>();

  async findByIdAndRestaurantId(id: BranchId, restaurantId: RestaurantId): Promise<Branch | null> {
    const branch = this.rows.get(id.value);
    if (!branch || branch.restaurantId.value !== restaurantId.value || branch.isSoftDeleted()) {
      return null;
    }
    return branch;
  }

  async findById(id: BranchId): Promise<Branch | null> {
    const branch = this.rows.get(id.value);
    if (!branch || branch.isSoftDeleted()) {
      return null;
    }
    return branch;
  }

  async findManyByRestaurantId(
    restaurantId: RestaurantId,
    page: number,
    limit: number,
  ): Promise<BranchListPage> {
    const active = [...this.rows.values()]
      .filter(
        (branch) => branch.restaurantId.value === restaurantId.value && !branch.isSoftDeleted(),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const start = (page - 1) * limit;
    return { items: active.slice(start, start + limit), total: active.length };
  }

  async save(branch: Branch): Promise<void> {
    this.rows.set(branch.branchId.value, branch);
  }
}
