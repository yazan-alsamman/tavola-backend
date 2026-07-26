import { Table } from '../entities/table.entity';
import { BranchId, FloorPlanId, TableId } from '@shared/domain/value-objects/identifiers.vo';

export interface TableListPage {
  items: Table[];
  total: number;
}

/**
 * No `organizationId`/`restaurantId` parameter on any method: `Table` carries
 * no direct `organizationId` column, tenant-owned only transitively via
 * `branchId -> Branch.restaurantId -> Restaurant.organizationId` - the same
 * pattern `BranchRepository` already uses. `findById` (no branch filter)
 * exists only to support Phase 6.1's flat individual-resource routes
 * (`GET`/`PATCH`/`DELETE /tables/:tableId>` - TASKS.md Phase 6.1 Routing
 * decision); callers MUST resolve the returned row's parent Branch then
 * Restaurant afterward to complete tenant validation (see
 * `GetTableUseCase`'s own comment) - it is never a substitute for the
 * compound `findByIdAndBranchId` lookup used by nested routes.
 */
export interface TableRepository {
  findById(id: TableId): Promise<Table | null>;
  findByIdAndBranchId(id: TableId, branchId: BranchId): Promise<Table | null>;
  findManyByBranchId(branchId: BranchId, page: number, limit: number): Promise<TableListPage>;
  findManyByFloorPlanId(
    floorPlanId: FloorPlanId,
    page: number,
    limit: number,
  ): Promise<TableListPage>;
  /**
   * Phase 7.1 (Reservation Core, Search Availability) - every non-soft-deleted
   * `Available`-status table in the branch whose *effective* capacity is
   * `>= minCapacity`. Unpaginated, matching `FloorPlan`'s own "Create/List
   * (unpaginated)" precedent - a branch's table count is naturally bounded
   * by its floor plan. `TableStatus.Disabled`/`Cleaning`/`Occupied`/`Merged`
   * tables are excluded entirely here (DOMAIN_MODEL.md's Tables business
   * rules; a `Merged` secondary is never independently `Available`) - this
   * is a different, narrower filter than the Availability Search
   * *contract*'s own Reserved/Unavailable marking, which happens one layer
   * up once a `Pending`/`Approved` reservation is found for an `Available`
   * table.
   *
   * Phase 6 (Merge/Split Tables, ADR-026 decision #4/#14): "effective
   * capacity" means each returned row's own `capacity` column for an
   * unmerged table, but `TableMergeService.computeEffectiveCapacity` (the
   * sum of every member's permanent `capacity`, including `Merged`
   * secondaries) for a merge primary - implementations resolve this
   * internally (loading merge-group siblings as needed); callers receive
   * only tables that already satisfy `minCapacity` either way. Every
   * returned `Table.capacity` value is still that row's own unmodified
   * permanent capacity - `capacity` columns are never overwritten.
   */
  findManyAvailableByBranchIdAndMinCapacity(
    branchId: BranchId,
    minCapacity: number,
  ): Promise<Table[]>;
  existsByBranchIdAndTableNumber(
    branchId: BranchId,
    tableNumber: string,
    excludeId?: TableId,
  ): Promise<boolean>;
  save(table: Table): Promise<void>;
  /**
   * Phase 6 (Merge/Split Tables, ADR-026) - every non-soft-deleted Table
   * matching one of `ids`, in no particular order; an id with no matching
   * row is simply absent from the result (the caller, e.g.
   * `MergeTablesUseCase`, compares `result.length`/membership against the
   * requested `ids` to detect a missing/cross-tenant table). No tenant
   * filter, same caller-responsibility caveat as `findById`.
   */
  findManyByIds(ids: TableId[]): Promise<Table[]>;
  /**
   * Phase 6 (Merge/Split Tables, ADR-026) - every non-soft-deleted member
   * (primary and secondaries alike) of an active merge group, in no
   * particular order. Returns an empty array for an unknown/inactive
   * `mergeGroupId`.
   */
  findManyByMergeGroupId(mergeGroupId: string): Promise<Table[]>;
  /**
   * Phase 6 (Merge/Split Tables, ADR-026 decision #7) - acquires one
   * transaction-scoped PostgreSQL advisory lock per id in `tableIds`, via
   * `TableTopologyLockService.deriveLockKeysInOrder` (sorted ascending, a
   * separate "topology" namespace from ADR-013/023's slot-bucket keys).
   * MUST be called inside an active transaction (`UnitOfWorkPort.execute`) -
   * the locks release automatically at commit/rollback. Reservation Create/
   * Approve/Reschedule/Waitlist-reserve paths must acquire the same locks,
   * in the same order, BEFORE their own ADR-013/023 slot locks (this
   * ordering is out of scope for this method itself - it only acquires what
   * it is asked to).
   */
  acquireTopologyLocks(tableIds: string[]): Promise<void>;
  /**
   * Phase 6 (Merge/Split Tables, ADR-026) - persists every table in `tables`
   * (each an ordinary `save()`-shaped upsert). Used by `MergeTablesUseCase`/
   * `SplitTablesUseCase` to persist every member of a merge group atomically
   * inside one `UnitOfWorkPort.execute` transaction - not a new persistence
   * mechanism, just a convenience over calling `save()` once per member.
   */
  saveMany(tables: Table[]): Promise<void>;
  /**
   * Bulk soft-delete of every (non-soft-deleted) Table for one branch - used
   * only by `DeleteBranchUseCase`'s cascade, inside its own transaction. Not
   * a per-row entity round trip, matching
   * `BranchWorkingHoursRepository.replaceAllForBranch`'s own bulk precedent.
   */
  softDeleteAllForBranch(branchId: BranchId, at: Date): Promise<void>;
}

export const TABLE_REPOSITORY = Symbol('TABLE_REPOSITORY');
