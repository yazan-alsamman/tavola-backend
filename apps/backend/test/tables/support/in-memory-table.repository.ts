import { Table } from '@modules/tables/domain/entities/table.entity';
import { TableStatus } from '@modules/tables/domain/enums/table.enums';
import { TableMergeService } from '@modules/tables/domain/services/table-merge.service';
import { TableTopologyLockService } from '@modules/tables/domain/services/table-topology-lock.service';
import {
  TableListPage,
  TableRepository,
} from '@modules/tables/domain/repositories/table.repository';
import { BranchId, FloorPlanId, TableId } from '@shared/domain/value-objects/identifiers.vo';

export class InMemoryTableRepository implements TableRepository {
  private readonly rows = new Map<string, Table>();
  public readonly acquiredLockKeys: string[] = [];

  async findById(id: TableId): Promise<Table | null> {
    const table = this.rows.get(id.value);
    if (!table || table.isSoftDeleted()) {
      return null;
    }
    return table;
  }

  async findByIdAndBranchId(id: TableId, branchId: BranchId): Promise<Table | null> {
    const table = this.rows.get(id.value);
    if (!table || table.branchId.value !== branchId.value || table.isSoftDeleted()) {
      return null;
    }
    return table;
  }

  async findManyByBranchId(
    branchId: BranchId,
    page: number,
    limit: number,
  ): Promise<TableListPage> {
    const active = [...this.rows.values()]
      .filter((row) => row.branchId.value === branchId.value && !row.isSoftDeleted())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (page - 1) * limit;
    return { items: active.slice(start, start + limit), total: active.length };
  }

  async findManyByFloorPlanId(
    floorPlanId: FloorPlanId,
    page: number,
    limit: number,
  ): Promise<TableListPage> {
    const active = [...this.rows.values()]
      .filter((row) => row.floorPlanId.value === floorPlanId.value && !row.isSoftDeleted())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (page - 1) * limit;
    return { items: active.slice(start, start + limit), total: active.length };
  }

  async findManyAvailableByBranchIdAndMinCapacity(
    branchId: BranchId,
    minCapacity: number,
  ): Promise<Table[]> {
    const candidates = [...this.rows.values()].filter(
      (row) =>
        row.branchId.value === branchId.value &&
        !row.isSoftDeleted() &&
        row.status === TableStatus.Available,
    );

    // Mirrors the real Prisma repository (Phase 15 Optimization): one
    // batched merge-group lookup for the whole candidate set, not one
    // `findManyByMergeGroupId` call per merged candidate.
    const mergeGroupIds = candidates
      .filter((table) => table.mergeGroupId !== null)
      .map((table) => table.mergeGroupId as string);
    const membersByGroup = await this.findManyByMergeGroupIds(mergeGroupIds);

    const eligible: Table[] = [];
    for (const table of candidates) {
      if (table.mergeGroupId === null) {
        if (table.capacity >= minCapacity) {
          eligible.push(table);
        }
        continue;
      }
      const members = membersByGroup.get(table.mergeGroupId) ?? [];
      if (TableMergeService.computeEffectiveCapacity(members) >= minCapacity) {
        eligible.push(table);
      }
    }
    return eligible.sort((a, b) => a.tableNumber.localeCompare(b.tableNumber));
  }

  async existsByBranchIdAndTableNumber(
    branchId: BranchId,
    tableNumber: string,
    excludeId?: TableId,
  ): Promise<boolean> {
    return [...this.rows.values()].some(
      (row) =>
        row.branchId.value === branchId.value &&
        row.tableNumber === tableNumber &&
        (excludeId === undefined || row.tableId.value !== excludeId.value),
    );
  }

  async save(table: Table): Promise<void> {
    this.rows.set(table.tableId.value, table);
  }

  async findManyByIds(ids: TableId[]): Promise<Table[]> {
    return ids
      .map((id) => this.rows.get(id.value))
      .filter((row): row is Table => row !== undefined && !row.isSoftDeleted());
  }

  async findManyByMergeGroupId(mergeGroupId: string): Promise<Table[]> {
    return [...this.rows.values()].filter(
      (row) => row.mergeGroupId === mergeGroupId && !row.isSoftDeleted(),
    );
  }

  async findManyByMergeGroupIds(mergeGroupIds: string[]): Promise<Map<string, Table[]>> {
    if (mergeGroupIds.length === 0) {
      return new Map();
    }
    const uniqueIds = new Set(mergeGroupIds);
    const membersByGroup = new Map<string, Table[]>();
    for (const row of this.rows.values()) {
      if (row.mergeGroupId === null || row.isSoftDeleted() || !uniqueIds.has(row.mergeGroupId)) {
        continue;
      }
      const existing = membersByGroup.get(row.mergeGroupId);
      if (existing) {
        existing.push(row);
      } else {
        membersByGroup.set(row.mergeGroupId, [row]);
      }
    }
    return membersByGroup;
  }

  async acquireTopologyLocks(tableIds: string[]): Promise<void> {
    this.acquiredLockKeys.push(...TableTopologyLockService.deriveLockKeysInOrder(tableIds));
  }

  async saveMany(tables: Table[]): Promise<void> {
    for (const table of tables) {
      await this.save(table);
    }
  }

  async softDeleteAllForBranch(branchId: BranchId, at: Date): Promise<void> {
    for (const [key, row] of this.rows.entries()) {
      if (row.branchId.value === branchId.value && !row.isSoftDeleted()) {
        this.rows.set(key, Table.reconstitute({ ...row.toProps(), deletedAt: at, updatedAt: at }));
      }
    }
  }
}
