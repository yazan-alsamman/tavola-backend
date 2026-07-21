import { Branch } from '../entities/branch.entity';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';

export interface BranchListPage {
  items: Branch[];
  total: number;
}

/**
 * No `organizationId` parameter on any method: `Branch` carries no direct
 * `organizationId` column (schema.prisma's `Branch` model), so it is NOT in
 * `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS` - it is tenant-owned only
 * transitively, via `restaurantId -> Restaurant.organizationId` (TENANCY.md,
 * this same file's own long-standing doc comment). Tenant isolation is the
 * CALLER's responsibility: every use case must resolve the parent Restaurant
 * via the already-tenant-scoped `RestaurantRepository` first, and only call
 * this repository's methods after that succeeds - identical to the
 * `WorkingHoursRepository`/`RestaurantSettingsRepository` pattern.
 */
export interface BranchRepository {
  /**
   * Filters by both `id` AND `restaurantId` in one query - not `findById`
   * followed by a manual `branch.restaurantId === restaurantId` comparison -
   * so a branch belonging to a different restaurant than the one named in
   * the URL is indistinguishable from "does not exist" (IDOR protection).
   */
  findByIdAndRestaurantId(id: BranchId, restaurantId: RestaurantId): Promise<Branch | null>;
  /**
   * No `restaurantId` filter - exists only to support Phase 6.1's flat
   * Table routes (`GET`/`PATCH`/`DELETE /tables/:tableId>`), which resolve
   * tenant ownership by walking the relation chain upward from the Table row
   * (Table -> Branch -> Restaurant) rather than from a URL-supplied
   * `restaurantId`. Callers MUST follow this with a
   * `RestaurantRepository.findById(branch.restaurantId)` call (which IS
   * tenant-scoped) to complete tenant validation - see
   * `GetTableUseCase`/`UpdateTableUseCase`/`DeleteTableUseCase`'s own
   * comments. Never a substitute for `findByIdAndRestaurantId` on routes that
   * already have a URL-supplied `restaurantId`.
   */
  findById(id: BranchId): Promise<Branch | null>;
  findManyByRestaurantId(
    restaurantId: RestaurantId,
    page: number,
    limit: number,
  ): Promise<BranchListPage>;
  save(branch: Branch): Promise<void>;
}

export const BRANCH_REPOSITORY = Symbol('BRANCH_REPOSITORY');
