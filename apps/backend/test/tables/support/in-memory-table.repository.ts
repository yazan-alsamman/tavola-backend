import { Table } from '@modules/tables/domain/entities/table.entity';
import { TableStatus } from '@modules/tables/domain/enums/table.enums';
import {
  TableListPage,
  TableRepository,
} from '@modules/tables/domain/repositories/table.repository';
import { BranchId, FloorPlanId, TableId } from '@shared/domain/value-objects/identifiers.vo';

export class InMemoryTableRepository implements TableRepository {
  private readonly rows = new Map<string, Table>();

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
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.branchId.value === branchId.value &&
          !row.isSoftDeleted() &&
          row.status === TableStatus.Available &&
          row.capacity >= minCapacity,
      )
      .sort((a, b) => a.tableNumber.localeCompare(b.tableNumber));
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

  async softDeleteAllForBranch(branchId: BranchId, at: Date): Promise<void> {
    for (const [key, row] of this.rows.entries()) {
      if (row.branchId.value === branchId.value && !row.isSoftDeleted()) {
        this.rows.set(key, Table.reconstitute({ ...row.toProps(), deletedAt: at, updatedAt: at }));
      }
    }
  }
}
