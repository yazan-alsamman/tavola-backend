import { FloorPlanArea } from '@modules/tables/domain/entities/floor-plan-area.entity';
import { Table } from '@modules/tables/domain/entities/table.entity';
import { FloorPlanAreaRepository } from '@modules/tables/domain/repositories/floor-plan-area.repository';
import { FloorPlanAreaId, FloorPlanId } from '@shared/domain/value-objects/identifiers.vo';

/**
 * ADR-040 in-memory double for `FloorPlanAreaRepository`.
 *
 * `countAssignedTables` reads from an injected `InMemoryTableRepository`-style
 * source rather than keeping its own copy of the tables: the deletion guard it
 * feeds is only meaningful if it sees the same rows the table repository does,
 * and a second store would let a test pass while the two disagree. Tests that
 * never exercise the guard can leave `tableSource` unset - it then reports zero
 * assigned tables, which is the truth for an empty world.
 */
export class InMemoryFloorPlanAreaRepository implements FloorPlanAreaRepository {
  private readonly rows = new Map<string, FloorPlanArea>();

  constructor(private readonly tableSource?: { all(): Table[] }) {}

  async findByIdAndFloorPlanId(
    id: FloorPlanAreaId,
    floorPlanId: FloorPlanId,
  ): Promise<FloorPlanArea | null> {
    const area = this.rows.get(id.value);
    if (!area || area.floorPlanId.value !== floorPlanId.value || area.isSoftDeleted()) {
      return null;
    }
    return area;
  }

  async findManyByFloorPlanId(floorPlanId: FloorPlanId): Promise<FloorPlanArea[]> {
    return [...this.rows.values()]
      .filter((row) => row.floorPlanId.value === floorPlanId.value && !row.isSoftDeleted())
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime());
  }

  async existsByFloorPlanIdAndName(
    floorPlanId: FloorPlanId,
    name: string,
    excludeId?: FloorPlanAreaId,
  ): Promise<boolean> {
    return [...this.rows.values()].some(
      (row) =>
        row.floorPlanId.value === floorPlanId.value &&
        row.name === name &&
        !row.isSoftDeleted() &&
        row.floorPlanAreaId.value !== excludeId?.value,
    );
  }

  async countAssignedTables(id: FloorPlanAreaId): Promise<number> {
    if (!this.tableSource) {
      return 0;
    }
    return this.tableSource
      .all()
      .filter((table) => table.floorPlanAreaId === id.value && !table.isSoftDeleted()).length;
  }

  async save(area: FloorPlanArea): Promise<void> {
    this.rows.set(area.floorPlanAreaId.value, area);
  }
}
