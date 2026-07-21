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
   * `Available`-status table in the branch with `capacity >= minCapacity`.
   * Unpaginated, matching `FloorPlan`'s own "Create/List (unpaginated)"
   * precedent - a branch's table count is naturally bounded by its floor
   * plan. `TableStatus.Disabled`/`Cleaning`/`Occupied` tables are excluded
   * entirely here (DOMAIN_MODEL.md's Tables business rules) - this is a
   * different, narrower filter than the Availability Search *contract*'s own
   * Reserved/Unavailable marking, which happens one layer up once a
   * `Pending`/`Approved` reservation is found for an `Available` table.
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
   * Bulk soft-delete of every (non-soft-deleted) Table for one branch - used
   * only by `DeleteBranchUseCase`'s cascade, inside its own transaction. Not
   * a per-row entity round trip, matching
   * `BranchWorkingHoursRepository.replaceAllForBranch`'s own bulk precedent.
   */
  softDeleteAllForBranch(branchId: BranchId, at: Date): Promise<void>;
}

export const TABLE_REPOSITORY = Symbol('TABLE_REPOSITORY');
