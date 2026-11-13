import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { BranchCoverImageRepository } from '@modules/restaurants/domain/repositories/branch-cover-image.repository';

export class InMemoryBranchCoverImageRepository implements BranchCoverImageRepository {
  /** branchId -> { restaurantId, coverImageId } for live branches. */
  readonly branches = new Map<string, { restaurantId: string; coverImageId: string | null }>();
  /** File ids still referenced by a restaurant cover or logo. */
  readonly restaurantReferences: string[] = [];

  async findCoverImageId(
    restaurantId: RestaurantId,
    branchId: string,
  ): Promise<string | null | undefined> {
    const branch = this.branches.get(branchId);
    if (branch === undefined || branch.restaurantId !== restaurantId.value) {
      return undefined;
    }
    return branch.coverImageId;
  }

  async assignCoverImage(branchId: string, fileId: string): Promise<void> {
    const branch = this.branches.get(branchId);
    if (branch !== undefined) {
      branch.coverImageId = fileId;
    }
  }

  async countCoverReferences(fileId: string): Promise<number> {
    const fromBranches = [...this.branches.values()].filter(
      (b) => b.coverImageId === fileId,
    ).length;
    return fromBranches + this.restaurantReferences.filter((id) => id === fileId).length;
  }
}
