import { FloorPlan } from '@modules/tables/domain/entities/floor-plan.entity';
import { FloorPlanRepository } from '@modules/tables/domain/repositories/floor-plan.repository';
import { BranchId, FloorPlanId } from '@shared/domain/value-objects/identifiers.vo';

export class InMemoryFloorPlanRepository implements FloorPlanRepository {
  private readonly rows = new Map<string, FloorPlan>();

  async findByIdAndBranchId(id: FloorPlanId, branchId: BranchId): Promise<FloorPlan | null> {
    const floorPlan = this.rows.get(id.value);
    if (!floorPlan || floorPlan.branchId.value !== branchId.value || floorPlan.isSoftDeleted()) {
      return null;
    }
    return floorPlan;
  }

  async findManyByBranchId(branchId: BranchId): Promise<FloorPlan[]> {
    return [...this.rows.values()]
      .filter((row) => row.branchId.value === branchId.value && !row.isSoftDeleted())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async existsAnyForBranch(branchId: BranchId): Promise<boolean> {
    return [...this.rows.values()].some(
      (row) => row.branchId.value === branchId.value && !row.isSoftDeleted(),
    );
  }

  async save(floorPlan: FloorPlan): Promise<void> {
    this.rows.set(floorPlan.floorPlanId.value, floorPlan);
  }

  async activate(id: FloorPlanId, branchId: BranchId, at: Date): Promise<FloorPlan> {
    for (const [key, row] of this.rows.entries()) {
      if (row.branchId.value === branchId.value && !row.isSoftDeleted() && row.isActive) {
        this.rows.set(
          key,
          FloorPlan.reconstitute({ ...row.toProps(), isActive: false, updatedAt: at }),
        );
      }
    }
    const target = this.rows.get(id.value);
    if (!target) {
      throw new Error('FloorPlan not found in InMemoryFloorPlanRepository.activate');
    }
    const activated = FloorPlan.reconstitute({
      ...target.toProps(),
      isActive: true,
      updatedAt: at,
    });
    this.rows.set(id.value, activated);
    return activated;
  }

  async softDeleteAllForBranch(branchId: BranchId, at: Date): Promise<void> {
    for (const [key, row] of this.rows.entries()) {
      if (row.branchId.value === branchId.value && !row.isSoftDeleted()) {
        this.rows.set(
          key,
          FloorPlan.reconstitute({ ...row.toProps(), deletedAt: at, updatedAt: at }),
        );
      }
    }
  }
}
