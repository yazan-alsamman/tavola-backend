import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  BranchCategoryEntry,
  BranchCategoryKind,
  BranchCategoryRepository,
} from '@modules/branches/domain/repositories/branch-category.repository';

export class InMemoryBranchCategoryRepository implements BranchCategoryRepository {
  /** `${kind}:${branchId}` -> category ids. */
  private readonly assignments = new Map<string, string[]>();
  /** branchId -> restaurantId for live branches. */
  readonly liveBranches = new Map<string, string>();

  async findCategoryIds(branchId: BranchId, kind: BranchCategoryKind): Promise<string[]> {
    return [...(this.assignments.get(`${kind}:${branchId.value}`) ?? [])];
  }

  async replaceCategoryIds(
    branchId: BranchId,
    kind: BranchCategoryKind,
    entries: BranchCategoryEntry[],
  ): Promise<void> {
    this.assignments.set(
      `${kind}:${branchId.value}`,
      entries.map((entry) => entry.categoryId),
    );
  }

  async findCategoryIdsOfLiveBranches(
    restaurantId: RestaurantId,
    kind: BranchCategoryKind,
  ): Promise<string[]> {
    const ids = new Set<string>();
    for (const [branchId, owner] of this.liveBranches) {
      if (owner !== restaurantId.value) continue;
      for (const id of this.assignments.get(`${kind}:${branchId}`) ?? []) ids.add(id);
    }
    return [...ids];
  }
}
