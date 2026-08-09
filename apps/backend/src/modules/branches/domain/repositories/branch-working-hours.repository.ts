import { BranchWorkingHours } from '../entities/branch-working-hours.entity';
import { BranchId } from '@shared/domain/value-objects/identifiers.vo';

/**
 * No `restaurantId`/`organizationId` parameter on any method: `BranchWorkingHours`
 * is NOT in `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS` (no direct
 * `organizationId` column - see the Prisma schema's own comment on this
 * model). Tenant isolation is the CALLER's responsibility: every use case
 * must resolve the parent Restaurant via the already-tenant-scoped
 * `RestaurantRepository`, then the parent Branch via `BranchRepository`
 * (`findByIdAndRestaurantId`), and only call this repository's methods after
 * both succeed - identical pattern to `WorkingHoursRepository`, with one
 * extra hop.
 */
export interface BranchWorkingHoursRepository {
  findAllByBranchId(branchId: BranchId): Promise<BranchWorkingHours[]>;
  /** Batched lookup across many branches in one query - avoids N+1 (see `ListBranchWorkingHoursByBranchIdsUseCase`). */
  findAllByBranchIds(branchIds: BranchId[]): Promise<BranchWorkingHours[]>;
  replaceAllForBranch(branchId: BranchId, entries: BranchWorkingHours[]): Promise<void>;
}

export const BRANCH_WORKING_HOURS_REPOSITORY = Symbol('BRANCH_WORKING_HOURS_REPOSITORY');
