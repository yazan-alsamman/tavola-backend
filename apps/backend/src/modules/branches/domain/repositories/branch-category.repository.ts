import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';

export type BranchCategoryKind = 'cuisine' | 'occasion';

export interface BranchCategoryEntry {
  /** Row id, from the IdGenerator. */
  id: string;
  categoryId: string;
}

/**
 * Per-branch cuisine and occasion assignments (ADR-051). Passthrough like
 * every Branch child table: callers resolve the restaurant and the branch
 * through the tenant-scoped repositories first.
 */
export interface BranchCategoryRepository {
  findCategoryIds(branchId: BranchId, kind: BranchCategoryKind): Promise<string[]>;
  /** Full replace: `entries` become the branch's whole assignment of that kind. */
  replaceCategoryIds(
    branchId: BranchId,
    kind: BranchCategoryKind,
    entries: BranchCategoryEntry[],
    at: Date,
  ): Promise<void>;
  /** The distinct ids assigned to any live branch of the restaurant. */
  findCategoryIdsOfLiveBranches(
    restaurantId: RestaurantId,
    kind: BranchCategoryKind,
  ): Promise<string[]>;
}

export const BRANCH_CATEGORY_REPOSITORY = Symbol('BRANCH_CATEGORY_REPOSITORY');
