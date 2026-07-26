import { Table } from '../entities/table.entity';
import { TableStatus } from '../enums/table.enums';
import { InvalidTableException } from '../exceptions/invalid-table.exception';
import { TableMergeConflictException } from '../exceptions/table-merge-conflict.exception';

/**
 * Phase 6 (Merge/Split Tables, ADR-026). Pure domain logic shared by
 * `MergeTablesUseCase` - called once before the topology lock (fail fast on
 * an obviously-invalid request) and again immediately after re-reading the
 * tables inside the lock (ADR-026 decision #7's "re-read; re-check; mutate"
 * step, the authoritative check). Deliberately framework/repository-free:
 * every method operates only on already-loaded `Table` entities.
 */
export class TableMergeService {
  /**
   * ADR-026 decision #1/#5: an optional `primaryTableId` (must be one of
   * `tables`) always wins; otherwise the lowest `tableNumber`, then `Table.id`
   * ascending, matching `(branchId, tableNumber)`'s own uniqueness guarantee
   * (no two tables in the set can tie on `tableNumber` - they share a branch)
   * so the `Table.id` tiebreaker is a defensive, never-actually-reached
   * fallback.
   */
  static selectPrimary(tables: Table[], primaryTableId?: string): Table {
    if (primaryTableId !== undefined) {
      const requested = tables.find((table) => table.tableId.value === primaryTableId);
      if (requested === undefined) {
        throw new InvalidTableException(
          `primaryTableId "${primaryTableId}" is not one of the tables being merged.`,
        );
      }
      return requested;
    }

    return [...tables].sort((a, b) => {
      const byTableNumber = a.tableNumber.localeCompare(b.tableNumber);
      return byTableNumber !== 0 ? byTableNumber : a.tableId.value.localeCompare(b.tableId.value);
    })[0];
  }

  /**
   * ADR-026 decision #4: `effectiveCapacity = SUM(member permanent
   * capacities)` - permanent `capacity` columns are never overwritten; this
   * is purely a derived, in-memory read-time value.
   */
  static computeEffectiveCapacity(members: Table[]): number {
    return members.reduce((sum, table) => sum + table.capacity, 0);
  }

  /**
   * ADR-026 decision #5: same Branch, same FloorPlan, all `Available` at
   * merge time, not already merged, no nested merges, minimum 2 distinct
   * IDs. Malformed-request shape (duplicate/insufficient ids) throws
   * `InvalidTableException` (400); state that disagrees with the request
   * (cross-branch/cross-floor-plan, not Available, already merged) throws
   * `TableMergeConflictException` (409) - the request was well-formed, the
   * current server state is not.
   */
  static assertMergeable(tables: Table[]): void {
    const uniqueIds = new Set(tables.map((table) => table.tableId.value));
    if (uniqueIds.size !== tables.length) {
      throw new InvalidTableException('Cannot merge the same table more than once.');
    }
    if (tables.length < 2) {
      throw new InvalidTableException('Merging requires at least 2 distinct tables.');
    }

    const [first, ...rest] = tables;
    for (const table of rest) {
      if (table.branchId.value !== first.branchId.value) {
        throw new TableMergeConflictException(
          'All tables being merged must belong to the same branch.',
        );
      }
      if (table.floorPlanId.value !== first.floorPlanId.value) {
        throw new TableMergeConflictException(
          'All tables being merged must belong to the same floor plan.',
        );
      }
    }

    for (const table of tables) {
      if (table.status !== TableStatus.Available) {
        throw new TableMergeConflictException(
          `Table "${table.tableId.value}" is not Available (current status: "${table.status}") - only Available tables can be merged.`,
        );
      }
      if (table.isInMergeGroup) {
        throw new TableMergeConflictException(
          `Table "${table.tableId.value}" is already part of a merge group - split it first.`,
        );
      }
    }
  }
}
