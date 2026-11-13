import { BranchClosure } from '../entities/branch-closure.entity';

export const BRANCH_CLOSURE_REPOSITORY = Symbol('BRANCH_CLOSURE_REPOSITORY');

/**
 * ADR-053. No tenant scoping of its own (branch child table): callers resolve
 * the restaurant and branch through `BranchAccessService` first, except the
 * reservation checks, which already resolved the branch from a public id.
 */
export interface BranchClosureRepository {
  /** Closures that end on or after `fromDate` (YYYY-MM-DD), earliest first. */
  findUpcoming(branchId: string, fromDate: string): Promise<BranchClosure[]>;
  findById(id: string, branchId: string): Promise<BranchClosure | null>;
  /** True when any closure of the branch covers `date` (YYYY-MM-DD). */
  isClosedOn(branchId: string, date: string): Promise<boolean>;
  save(closure: BranchClosure): Promise<void>;
  remove(id: string): Promise<void>;
}
