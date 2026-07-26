/**
 * Phase 6 (Merge/Split Tables, ADR-026 decision #7). Topology locking
 * extends ADR-013's concurrency *guarantee*, not its slot-key mechanism:
 * inside one DB transaction, every involved `Table.id` is sorted ascending
 * and a transaction-scoped PostgreSQL advisory lock is acquired for each,
 * in a separate "topology" namespace from ADR-013/023's slot-bucket keys -
 * before any conflict check or mutation. Reservation Create/Approve/
 * Reschedule/Waitlist-reserve paths must acquire the same locks, in the same
 * sorted order, BEFORE their own slot locks (ADR-026 decision #7's
 * "Compatibility with ADR-013/023" clause) - a static, dependency-free
 * helper so both `TableRepository.acquireTopologyLocks` and those call
 * sites derive identical keys without importing each other's modules.
 */
export class TableTopologyLockService {
  static deriveLockKey(tableId: string): string {
    return `topology:table:${tableId}`;
  }

  static sortTableIds(tableIds: string[]): string[] {
    return [...new Set(tableIds)].sort();
  }

  static deriveLockKeysInOrder(tableIds: string[]): string[] {
    return this.sortTableIds(tableIds).map((id) => this.deriveLockKey(id));
  }
}
